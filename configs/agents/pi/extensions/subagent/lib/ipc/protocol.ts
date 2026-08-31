import { StringDecoder } from "node:string_decoder";
import { MAX_ARTIFACT_PAGE_BYTES, MAX_ARTIFACT_PAGE_LINES } from "../artifacts/artifacts";
import { MAX_WAIT_TIMEOUT_MS } from "../supervisor/limits";
import type {
  AgentWaitParams,
  FollowupParams,
  ListParams,
  SendParams,
  SpawnParams,
  TargetParams,
} from "../tools/schemas";

export const IPC_PROTOCOL_VERSION = 1 as const;
/** Bounds one authenticated encoded control-plane record; raw assignment size varies with JSON escaping. */
export const IPC_RECORD_LIMIT_BYTES = 2 * 1024 * 1024;
/** Remote error text is bounded independently from the frame cap. */
export const IPC_ERROR_MESSAGE_MAX_BYTES = 1024;

export const IPC_OPERATIONS = [
  "agent_spawn",
  "agent_send",
  "agent_followup",
  "agent_wait",
  "agent_interrupt",
  "agent_list",
  "agent_close",
] as const;

export type IpcOperation = (typeof IPC_OPERATIONS)[number];
export type IpcOperationPayload = {
  agent_spawn: SpawnParams;
  agent_send: SendParams;
  agent_followup: FollowupParams;
  agent_wait: AgentWaitParams;
  agent_interrupt: TargetParams;
  agent_list: ListParams;
  agent_close: TargetParams;
};

export interface IpcRequestFrame {
  version: typeof IPC_PROTOCOL_VERSION;
  type: "request";
  id: string;
  operation: IpcOperation | "authenticate";
  payload: Readonly<Record<string, unknown>>;
}

export type IpcResponseFrame =
  | {
      version: typeof IPC_PROTOCOL_VERSION;
      type: "response";
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      version: typeof IPC_PROTOCOL_VERSION;
      type: "response";
      id: string;
      ok: false;
      error: { kind: string; message: string };
    };

export interface IpcCancelFrame {
  version: typeof IPC_PROTOCOL_VERSION;
  type: "cancel";
  id: string;
}

export type IpcFrame = IpcRequestFrame | IpcResponseFrame | IpcCancelFrame;

export class IpcProtocolError extends Error {
  constructor(
    readonly kind: "malformed_record" | "record_too_large" | "invalid_frame",
    message: string,
  ) {
    super(message);
    this.name = "IpcProtocolError";
  }
}

/** Strict LF framing with optional CR and incremental UTF-8 decoding. */
export class IpcJsonlDecoder {
  private decoder = new StringDecoder("utf8");
  private text = "";
  private bytes = 0;

  constructor(
    private readonly onFrame: (frame: IpcFrame) => void,
    private readonly maxRecordBytes = IPC_RECORD_LIMIT_BYTES,
  ) {
    if (!Number.isInteger(maxRecordBytes) || maxRecordBytes < 1) {
      throw new RangeError("IPC record limit must be a positive integer");
    }
  }

  push(chunk: Uint8Array | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk);
    let offset = 0;
    while (offset < bytes.length) {
      const lf = bytes.indexOf(0x0a, offset);
      const end = lf === -1 ? bytes.length : lf;
      const segment = bytes.subarray(offset, end);
      this.append(segment);
      if (lf === -1) return;
      this.finishRecord();
      offset = lf + 1;
    }
  }

  end(): void {
    if (this.bytes !== 0 || this.text.length !== 0) {
      throw new IpcProtocolError("malformed_record", "IPC input ended with an unterminated record");
    }
  }

  private append(segment: Buffer): void {
    if (this.bytes + segment.byteLength > this.maxRecordBytes) {
      throw new IpcProtocolError("record_too_large", "IPC record exceeds the hard byte limit");
    }
    this.bytes += segment.byteLength;
    this.text += this.decoder.write(segment);
  }

  private finishRecord(): void {
    let record = this.text + this.decoder.end();
    this.decoder = new StringDecoder("utf8");
    this.text = "";
    this.bytes = 0;
    if (record.endsWith("\r")) record = record.slice(0, -1);
    if (!record) throw new IpcProtocolError("malformed_record", "IPC records must not be empty");

    let parsed: unknown;
    try {
      parsed = JSON.parse(record) as unknown;
    } catch {
      throw new IpcProtocolError("malformed_record", "IPC record is not valid JSON");
    }
    this.onFrame(parseIpcFrame(parsed));
  }
}

export function boundIpcErrorMessage(message: string): string {
  const bytes = Buffer.from(message, "utf8");
  if (bytes.byteLength <= IPC_ERROR_MESSAGE_MAX_BYTES) return message;
  const suffix = "…";
  const maximumPrefixBytes = IPC_ERROR_MESSAGE_MAX_BYTES - Buffer.byteLength(suffix, "utf8");
  for (let end = maximumPrefixBytes; end >= maximumPrefixBytes - 3; end -= 1) {
    try {
      const prefix = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
      return `${prefix}${suffix}`;
    } catch {
      // At most three trailing bytes can be an incomplete UTF-8 code point.
    }
  }
  return suffix;
}

export function encodeIpcFrame(frame: IpcFrame, maxRecordBytes = IPC_RECORD_LIMIT_BYTES): string {
  const record = JSON.stringify(frame);
  if (Buffer.byteLength(record, "utf8") > maxRecordBytes) {
    throw new IpcProtocolError("record_too_large", "IPC record exceeds the hard byte limit");
  }
  return `${record}\n`;
}

export function requestFrame(
  id: string,
  operation: IpcRequestFrame["operation"],
  payload: Readonly<Record<string, unknown>>,
): IpcRequestFrame {
  requireId(id);
  return { version: IPC_PROTOCOL_VERSION, type: "request", id, operation, payload };
}

export function cancelFrame(id: string): IpcCancelFrame {
  requireId(id);
  return { version: IPC_PROTOCOL_VERSION, type: "cancel", id };
}

export function parseOperationPayload<Operation extends IpcOperation>(
  operation: Operation,
  input: Readonly<Record<string, unknown>>,
): IpcOperationPayload[Operation] {
  switch (operation) {
    case "agent_spawn":
      return parseSpawn(input) as IpcOperationPayload[Operation];
    case "agent_send":
      return parseSend(input) as IpcOperationPayload[Operation];
    case "agent_followup":
      return parseFollowup(input) as IpcOperationPayload[Operation];
    case "agent_wait":
      return parseWait(input) as IpcOperationPayload[Operation];
    case "agent_interrupt":
    case "agent_close":
      return parseTarget(input) as IpcOperationPayload[Operation];
    case "agent_list":
      exactKeys(input, []);
      return {} as IpcOperationPayload[Operation];
  }
}

function parseIpcFrame(value: unknown): IpcFrame {
  const record = requireRecord(value, "frame");
  if (record.version !== IPC_PROTOCOL_VERSION) invalid("Unsupported IPC protocol version");
  if (record.type === "request") {
    exactKeys(record, ["version", "type", "id", "operation", "payload"]);
    const operation = requireString(record.operation, "operation");
    if (operation !== "authenticate" && !isOperation(operation)) invalid("Unknown IPC operation");
    return requestFrame(requireId(record.id), operation, requireRecord(record.payload, "payload"));
  }
  if (record.type === "cancel") {
    exactKeys(record, ["version", "type", "id"]);
    return cancelFrame(requireId(record.id));
  }
  if (record.type === "response") {
    const id = requireId(record.id);
    if (record.ok === true) {
      exactKeys(record, ["version", "type", "id", "ok", "result"]);
      return { version: IPC_PROTOCOL_VERSION, type: "response", id, ok: true, result: record.result };
    }
    if (record.ok === false) {
      exactKeys(record, ["version", "type", "id", "ok", "error"]);
      const error = requireRecord(record.error, "error");
      exactKeys(error, ["kind", "message"]);
      return {
        version: IPC_PROTOCOL_VERSION,
        type: "response",
        id,
        ok: false,
        error: {
          kind: requireString(error.kind, "error kind"),
          message: requireString(error.message, "error message"),
        },
      };
    }
  }
  return invalid("Unknown IPC frame type");
}

function parseSpawn(input: Readonly<Record<string, unknown>>): SpawnParams {
  exactKeys(input, ["task_name", "subagent_type", "prompt", "context", "execution"], ["context", "execution"]);
  const context = input.context === undefined ? undefined : requireRecord(input.context, "context");
  if (context) exactKeys(context, ["fork_turns"], ["fork_turns"]);
  return {
    task_name: requireString(input.task_name, "task_name"),
    subagent_type: requireString(input.subagent_type, "subagent_type"),
    prompt: requireString(input.prompt, "prompt"),
    ...(context
      ? {
          context: {
            ...(context.fork_turns === undefined
              ? {}
              : { fork_turns: requireChoice(context.fork_turns, ["none", "all"], "fork_turns") }),
          },
        }
      : {}),
    ...(input.execution === undefined ? {} : { execution: parseExecution(input.execution) }),
  };
}

function parseSend(input: Readonly<Record<string, unknown>>): SendParams {
  exactKeys(input, ["target", "message"]);
  return { target: requireString(input.target, "target"), message: requireString(input.message, "message") };
}

function parseFollowup(input: Readonly<Record<string, unknown>>): FollowupParams {
  exactKeys(input, ["target", "message", "execution"], ["execution"]);
  return {
    target: requireString(input.target, "target"),
    message: requireString(input.message, "message"),
    ...(input.execution === undefined ? {} : { execution: parseExecution(input.execution) }),
  };
}

function parseWait(input: Readonly<Record<string, unknown>>): AgentWaitParams {
  if (input.operation === "read_artifact") {
    exactKeys(
      input,
      ["operation", "artifact_ref", "cursor", "page_bytes", "page_lines"],
      ["cursor", "page_bytes", "page_lines"],
    );
    const reference = requireString(input.artifact_ref, "artifact_ref");
    if (!/^subagent-artifact:[0-9a-f]{32}$/i.test(reference)) invalid("Invalid opaque artifact reference");
    return {
      operation: "read_artifact",
      artifact_ref: reference,
      ...(input.cursor === undefined
        ? {}
        : { cursor: requireInteger(input.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor") }),
      ...(input.page_bytes === undefined
        ? {}
        : { page_bytes: requireInteger(input.page_bytes, 4, MAX_ARTIFACT_PAGE_BYTES, "page_bytes") }),
      ...(input.page_lines === undefined
        ? {}
        : { page_lines: requireInteger(input.page_lines, 1, MAX_ARTIFACT_PAGE_LINES, "page_lines") }),
    };
  }

  exactKeys(
    input,
    ["operation", "targets", "condition", "timeout_seconds"],
    ["operation", "condition", "timeout_seconds"],
  );
  if (input.operation !== undefined) requireChoice(input.operation, ["wait"], "operation");
  if (!Array.isArray(input.targets) || input.targets.some((target) => typeof target !== "string")) {
    invalid("targets must be an array of strings");
  }
  const timeout = input.timeout_seconds;
  if (
    timeout !== undefined &&
    (!Number.isInteger(timeout) || (timeout as number) < 0 || (timeout as number) > MAX_WAIT_TIMEOUT_MS / 1_000)
  ) {
    invalid(`timeout_seconds must be a whole number from 0 to ${MAX_WAIT_TIMEOUT_MS / 1_000}`);
  }
  return {
    ...(input.operation === undefined ? {} : { operation: "wait" as const }),
    targets: [...input.targets] as string[],
    ...(input.condition === undefined
      ? {}
      : { condition: requireChoice(input.condition, ["all", "any"], "condition") }),
    ...(timeout === undefined ? {} : { timeout_seconds: timeout as number }),
  };
}

function parseTarget(input: Readonly<Record<string, unknown>>): TargetParams {
  exactKeys(input, ["target"]);
  return { target: requireString(input.target, "target") };
}

function parseExecution(input: unknown): NonNullable<SpawnParams["execution"]> {
  const execution = requireRecord(input, "execution");
  exactKeys(execution, ["provider", "model", "effort"], ["provider", "model", "effort"]);
  const provider = execution.provider === undefined ? undefined : requireString(execution.provider, "provider");
  const model = execution.model === undefined ? undefined : requireString(execution.model, "model");
  if ((provider === undefined) !== (model === undefined)) invalid("provider and model must be supplied together");
  const effort =
    execution.effort === undefined
      ? undefined
      : requireChoice(execution.effort, ["off", "minimal", "low", "medium", "high", "xhigh", "max"], "effort");
  return {
    ...(provider === undefined ? {} : { provider, model: model as string }),
    ...(effort === undefined ? {} : { effort }),
  };
}

function exactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) invalid("IPC object contains unknown fields");
  const optionalSet = new Set(optional);
  if (allowed.some((key) => !optionalSet.has(key) && !(key in record)))
    invalid("IPC object is missing required fields");
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} must be an object`);
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${label} must be a non-empty string`);
  return value;
}

function requireInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value as number;
}

function requireId(value: unknown): string {
  const id = requireString(value, "request id");
  if (id !== id.trim() || Buffer.byteLength(id, "utf8") > 128) invalid("Invalid IPC request id");
  return id;
}

function requireChoice<const Choice extends string>(value: unknown, choices: readonly Choice[], label: string): Choice {
  if (typeof value !== "string" || !choices.includes(value as Choice)) invalid(`Invalid ${label}`);
  return value as Choice;
}

function isOperation(value: string): value is IpcOperation {
  return (IPC_OPERATIONS as readonly string[]).includes(value);
}

function invalid(message: string): never {
  throw new IpcProtocolError("invalid_frame", message);
}

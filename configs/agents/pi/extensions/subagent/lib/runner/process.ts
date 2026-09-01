import { spawn } from "node:child_process";
import { PiRpcClient, RpcClientClosedError, type RpcRequestOptions, type RpcTransport } from "../rpc/client";
import type { RpcEvent, RpcSessionState } from "../rpc/protocol";
import { type RedactText, redactStringValues } from "../security/redaction";
import type { AgentExecutionSettings, AgentInvocation } from "./invocation";

export const MAX_STDERR_LIMIT_BYTES = 16 * 1024;
export const DEFAULT_STDERR_LIMIT_BYTES = MAX_STDERR_LIMIT_BYTES;
/** Production grace: 5 seconds balances Pi cleanup against reliable process-tree reclamation. */
export const DEFAULT_TERMINATION_GRACE_MS = 5_000;
export const MIN_TERMINATION_GRACE_MS = 1;
export const MAX_TERMINATION_GRACE_MS = 30_000;
/** Matches Pi's own RPC client command deadline without limiting assignment duration. */
export const DEFAULT_RPC_COMMAND_TIMEOUT_MS = 30_000;
export const MIN_RPC_COMMAND_TIMEOUT_MS = 1;
export const MAX_RPC_COMMAND_TIMEOUT_MS = 120_000;

export interface ResidentChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface ResidentChildProcess {
  writeStdin(record: string): void;
  onStdout(listener: (chunk: Uint8Array | string) => void): () => void;
  onStderr(listener: (chunk: Uint8Array | string) => void): () => void;
  onExit(listener: (exit: ResidentChildExit) => void): () => void;
  /** Terminates the complete child process tree (process group on Unix). */
  kill(signal: NodeJS.Signals): boolean;
}

export type SpawnResidentChild = (invocation: AgentInvocation) => ResidentChildProcess;

export interface AgentProcessRuntime {
  spawn: SpawnResidentChild;
}

export interface AgentProcessOptions {
  invocation: AgentInvocation;
  execution: AgentExecutionSettings;
  runtime?: AgentProcessRuntime;
  stderrLimitBytes?: number;
  terminationGraceMs?: number;
  rpcCommandTimeoutMs?: number;
  redact?: RedactText;
}

export interface AgentProcessState {
  status: "running" | "exited";
  sessionId: string;
  sessionFile?: string;
  execution: AgentExecutionSettings;
  isStreaming: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
}

export interface AgentAssignmentRequest {
  message: string;
  execution?: AgentExecutionSettings;
  signal?: AbortSignal;
}

export interface AgentSubmission {
  accepted: true;
  settlement: Promise<AgentSettlement>;
}

export interface AgentSettlement {
  kind: "settled";
  output: string | null;
  state: AgentProcessState;
}

export type AgentProcessEvent =
  | { type: "runtime"; name: string; payload: Readonly<Record<string, unknown>> }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null };

export type AgentProcessEventListener = (event: AgentProcessEvent) => void;

export type AgentProcessErrorKind =
  | "not_started"
  | "already_started"
  | "closed"
  | "assignment_active"
  | "execution_mismatch"
  | "process_exited";

export class AgentProcessError extends Error {
  constructor(
    readonly kind: AgentProcessErrorKind,
    message: string,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "AgentProcessError";
  }
}

/**
 * Pi-agnostic resident child boundary. RPC details stay inside this module and
 * callers observe accepted assignments, settlements, state, and runtime events.
 */
export class AgentProcess {
  private readonly runtime: AgentProcessRuntime;
  private readonly stderrTail: BoundedByteTail;
  private readonly terminationGraceMs: number;
  private readonly rpcCommandTimeoutMs: number;
  private readonly redact: RedactText;
  private readonly listeners = new Set<AgentProcessEventListener>();
  private child: ResidentChildProcess | undefined;
  private client: PiRpcClient | undefined;
  private removeStderrListener: (() => void) | undefined;
  private removeExitListener: (() => void) | undefined;
  private removeRpcListener: (() => void) | undefined;
  private exit: ResidentChildExit | undefined;
  private started = false;
  private closing = false;
  private activeSettlement: Promise<AgentSettlement> | undefined;

  constructor(private readonly options: AgentProcessOptions) {
    this.runtime = options.runtime ?? { spawn: spawnResidentChild };
    const stderrLimitBytes = options.stderrLimitBytes ?? DEFAULT_STDERR_LIMIT_BYTES;
    if (!Number.isInteger(stderrLimitBytes) || stderrLimitBytes < 0 || stderrLimitBytes > MAX_STDERR_LIMIT_BYTES) {
      throw new RangeError(`stderr limit must be an integer from 0 to ${MAX_STDERR_LIMIT_BYTES} bytes`);
    }
    this.stderrTail = new BoundedByteTail(stderrLimitBytes);
    this.terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    if (
      !Number.isInteger(this.terminationGraceMs) ||
      this.terminationGraceMs < MIN_TERMINATION_GRACE_MS ||
      this.terminationGraceMs > MAX_TERMINATION_GRACE_MS
    ) {
      throw new RangeError(
        `termination grace must be an integer from ${MIN_TERMINATION_GRACE_MS} to ${MAX_TERMINATION_GRACE_MS} milliseconds`,
      );
    }
    this.rpcCommandTimeoutMs = options.rpcCommandTimeoutMs ?? DEFAULT_RPC_COMMAND_TIMEOUT_MS;
    if (
      !Number.isInteger(this.rpcCommandTimeoutMs) ||
      this.rpcCommandTimeoutMs < MIN_RPC_COMMAND_TIMEOUT_MS ||
      this.rpcCommandTimeoutMs > MAX_RPC_COMMAND_TIMEOUT_MS
    ) {
      throw new RangeError(
        `RPC command timeout must be an integer from ${MIN_RPC_COMMAND_TIMEOUT_MS} to ${MAX_RPC_COMMAND_TIMEOUT_MS} milliseconds`,
      );
    }
    this.redact = options.redact ?? ((value) => value);
  }

  async startup(options: RpcRequestOptions = {}): Promise<AgentProcessState> {
    if (this.started) throw new AgentProcessError("already_started", "Agent process has already been started");
    if (this.closing) throw new AgentProcessError("closed", "Agent process is closed");
    this.started = true;

    const child = this.runtime.spawn(this.options.invocation);
    this.child = child;
    this.removeStderrListener = child.onStderr((chunk) => this.stderrTail.append(chunk));
    this.removeExitListener = child.onExit((exit) => this.handleExit(exit));
    this.client = new PiRpcClient(childTransport(child), { redact: this.redact });
    this.removeRpcListener = this.client.onEvent((event) => this.emitRuntimeEvent(event));

    try {
      const state = await this.client.getState(this.commandOptions(options.signal, options.timeoutMs));
      verifyExecution(state, this.options.execution);
      return this.mapState(state);
    } catch (error) {
      await this.close();
      if (error instanceof AgentProcessError) {
        throw new AgentProcessError(error.kind, this.redact(error.message), error.stderr || this.stderrText());
      }
      throw withStderr(error, this.stderrText(), this.redact);
    }
  }

  submit(request: AgentAssignmentRequest): Promise<AgentSubmission> {
    return this.acceptAssignment(request);
  }

  async send(message: string, signal?: AbortSignal): Promise<void> {
    requireMessage(message);
    const client = this.requireClient();
    const options = this.commandOptions(signal);
    const state = await client.getState(options);
    if (state.isStreaming && !state.isCompacting) {
      await client.steer(message, options);
      return;
    }
    await client.prompt(message, { ...options, streamingBehavior: "steer" });
  }

  followup(request: AgentAssignmentRequest): Promise<AgentSubmission> {
    return this.acceptAssignment(request);
  }

  interrupt(signal?: AbortSignal): Promise<void> {
    return this.requireClient().abort(this.commandOptions(signal));
  }

  async getState(signal?: AbortSignal): Promise<AgentProcessState> {
    const state = await this.requireClient().getState(this.commandOptions(signal));
    return this.mapState(state);
  }

  onEvent(listener: AgentProcessEventListener): () => void {
    if (this.closing) throw new AgentProcessError("closed", "Agent process is closed", this.stderrText());
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStderrTail(): string {
    return this.stderrText();
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    const child = this.child;

    if (child && !this.exit) {
      await new Promise<void>((resolve) => {
        let settled = false;
        let removeExit = () => {};
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(escalation);
          removeExit();
          resolve();
        };
        removeExit = child.onExit(() => finish());
        const escalation = setTimeout(() => {
          child.kill("SIGKILL");
          if (this.exit) finish();
        }, this.terminationGraceMs);
        escalation.unref();
        if (!child.kill("SIGTERM") && this.exit) finish();
      });
    }

    this.client?.close(new RpcClientClosedError("Agent process closed"));
    this.removeRpcListener?.();
    this.removeRpcListener = undefined;
    this.removeStderrListener?.();
    this.removeStderrListener = undefined;
    this.removeExitListener?.();
    this.removeExitListener = undefined;
    this.listeners.clear();
  }

  private async acceptAssignment(request: AgentAssignmentRequest): Promise<AgentSubmission> {
    requireMessage(request.message);
    if (this.activeSettlement) {
      throw new AgentProcessError(
        "assignment_active",
        "Agent process already has an active assignment",
        this.stderrText(),
      );
    }
    const client = this.requireClient();

    if (request.execution) await this.configureExecution(request.execution, request.signal);

    const settlementController = new AbortController();
    const settlement = this.finalizeAfterSettlement(client, settlementController.signal);
    this.activeSettlement = settlement;
    settlement
      .finally(() => {
        if (this.activeSettlement === settlement) this.activeSettlement = undefined;
      })
      .catch(() => {});

    try {
      await client.prompt(request.message, this.commandOptions(request.signal));
      return { accepted: true, settlement };
    } catch (error) {
      settlementController.abort();
      await settlement.catch(() => {});
      throw error;
    }
  }

  private async configureExecution(execution: AgentExecutionSettings, signal?: AbortSignal): Promise<void> {
    const client = this.requireClient();
    await client.setModel(execution.provider, execution.model, this.commandOptions(signal));
    await client.setThinkingLevel(execution.effort, this.commandOptions(signal));
    const state = await client.getState(this.commandOptions(signal));
    verifyExecution(state, execution);
  }

  private async finalizeAfterSettlement(client: PiRpcClient, signal: AbortSignal): Promise<AgentSettlement> {
    let observedSequence = client.getSettlementSequence();
    for (;;) {
      await client.waitForSettled({ signal, afterSequence: observedSequence });
      const evidenceSequence = client.getSettlementSequence();
      const output = await client.getLastAssistantText(this.commandOptions(signal));
      const state = await client.getState(this.commandOptions(signal));

      // A newer settlement is evidence that the state/output pair may belong to
      // an earlier continuation. Re-evaluate it immediately rather than losing it.
      if (client.getSettlementSequence() !== evidenceSequence) {
        observedSequence = evidenceSequence;
        continue;
      }
      if (!isQuiescent(state)) {
        observedSequence = evidenceSequence;
        continue;
      }
      return { kind: "settled", output: output === null ? null : this.redact(output), state: this.mapState(state) };
    }
  }

  private commandOptions(signal?: AbortSignal, timeoutMs = this.rpcCommandTimeoutMs): RpcRequestOptions {
    return { signal, timeoutMs };
  }

  private requireClient(): PiRpcClient {
    if (this.closing) throw new AgentProcessError("closed", "Agent process is closed", this.stderrText());
    if (!this.client) throw new AgentProcessError("not_started", "Agent process has not been started");
    if (this.exit) {
      throw new AgentProcessError("process_exited", this.redact(formatExit(this.exit)), this.stderrText());
    }
    return this.client;
  }

  private mapState(state: RpcSessionState): AgentProcessState {
    if (!state.model) {
      throw new AgentProcessError("execution_mismatch", "Child Pi reported no active model", this.stderrText());
    }
    return {
      status: this.exit ? "exited" : "running",
      sessionId: state.sessionId,
      ...(state.sessionFile ? { sessionFile: state.sessionFile } : {}),
      execution: {
        provider: state.model.provider,
        model: state.model.id,
        effort: state.thinkingLevel,
      },
      isStreaming: state.isStreaming,
      isCompacting: state.isCompacting,
      pendingMessageCount: state.pendingMessageCount,
    };
  }

  private handleExit(exit: ResidentChildExit): void {
    if (this.exit) return;
    this.exit = exit;
    for (const listener of [...this.listeners]) {
      listener({ type: "exit", code: exit.code, signal: exit.signal });
    }
  }

  private emitRuntimeEvent(event: RpcEvent): void {
    const { type, ...payload } = event;
    const redactedPayload = redactStringValues(payload, this.redact);
    for (const listener of [...this.listeners]) listener({ type: "runtime", name: type, payload: redactedPayload });
  }

  private stderrText(): string {
    return this.redact(this.stderrTail.text());
  }
}

export function createAgentProcess(options: AgentProcessOptions): AgentProcess {
  return new AgentProcess(options);
}

export function spawnResidentChild(invocation: AgentInvocation): ResidentChildProcess {
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });

  return {
    writeStdin(record) {
      if (!child.stdin.writable || child.stdin.destroyed) throw new Error("Child Pi stdin is not writable");
      child.stdin.write(record);
    },
    onStdout(listener) {
      child.stdout.on("data", listener);
      return () => child.stdout.removeListener("data", listener);
    },
    onStderr(listener) {
      child.stderr.on("data", listener);
      return () => child.stderr.removeListener("data", listener);
    },
    onExit(listener) {
      let notified = false;
      const notify = (exit: ResidentChildExit) => {
        if (notified) return;
        notified = true;
        cleanup();
        listener(exit);
      };
      const onError = (error: Error) => notify({ code: null, signal: null, error });
      const onClose = (code: number | null, signal: NodeJS.Signals | null) => notify({ code, signal });
      const cleanup = () => {
        child.removeListener("error", onError);
        child.removeListener("close", onClose);
      };
      child.once("error", onError);
      child.once("close", onClose);
      return cleanup;
    },
    kill(signal) {
      if (process.platform === "win32") {
        if (!child.pid) return child.kill(signal);
        const args = ["/pid", String(child.pid), "/t", ...(signal === "SIGKILL" ? ["/f"] : [])];
        const killer = spawn("taskkill", args, { shell: false, stdio: "ignore", windowsHide: true });
        killer.unref();
        return true;
      }
      if (!child.pid) return child.kill(signal);
      try {
        process.kill(-child.pid, signal);
        return true;
      } catch (error) {
        if (errorCode(error) === "ESRCH") return false;
        return child.kill(signal);
      }
    },
  };
}

function childTransport(child: ResidentChildProcess): RpcTransport {
  return {
    write: (record) => child.writeStdin(record),
    onData: (listener) => child.onStdout(listener),
    onClose: (listener) =>
      child.onExit((exit) => {
        listener(exit.error ?? new AgentProcessError("process_exited", formatExit(exit)));
      }),
  };
}

function isQuiescent(state: RpcSessionState): boolean {
  return !state.isStreaming && !state.isCompacting && state.pendingMessageCount === 0;
}

function verifyExecution(state: RpcSessionState, expected: AgentExecutionSettings): void {
  const actual = state.model
    ? `${state.model.provider}/${state.model.id}:${state.thinkingLevel}`
    : `none:${state.thinkingLevel}`;
  const requested = `${expected.provider}/${expected.model}:${expected.effort}`;
  if (
    !state.model ||
    state.model.provider !== expected.provider ||
    state.model.id !== expected.model ||
    state.thinkingLevel !== expected.effort
  ) {
    throw new AgentProcessError(
      "execution_mismatch",
      `Child Pi execution mismatch: requested ${requested}, effective ${actual}`,
    );
  }
}

class BoundedByteTail {
  private value = Buffer.alloc(0);

  constructor(private readonly maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new Error("stderr limit must be a non-negative integer");
  }

  append(chunk: Uint8Array | string): void {
    if (this.maxBytes === 0) return;
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    this.value = Buffer.concat([this.value, bytes]).subarray(-this.maxBytes);
  }

  text(): string {
    return this.value.toString("utf8");
  }
}

function requireMessage(message: string): void {
  if (!message.trim()) throw new Error("Agent message must not be empty");
}

function formatExit(exit: ResidentChildExit): string {
  if (exit.error) return `Child Pi process failed: ${exit.error.message}`;
  return `Child Pi process exited with code ${exit.code ?? "null"} and signal ${exit.signal ?? "null"}`;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

function withStderr(error: unknown, stderr: string, redact: RedactText): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const message = redact(cause.message);
  if (!stderr) return new Error(message, { cause });
  return new Error(`${message}\nChild stderr tail:\n${stderr}`, { cause });
}

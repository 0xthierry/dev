import type { RedactText } from "../security/redaction";
import { encodeJsonl, JsonlDecoder, type JsonObject } from "./jsonl";
import {
  isAgentSettledEvent,
  isBlockingExtensionUiMethod,
  isExtensionUiRequest,
  isRpcResponse,
  type ReasoningEffort,
  type RpcCommand,
  type RpcCommandType,
  type RpcEvent,
  type RpcInboundMessage,
  type RpcResponse,
  type RpcSessionState,
} from "./protocol";

export interface RpcTransport {
  write(record: string): void;
  onData(listener: (chunk: Uint8Array | string) => void): () => void;
  onClose(listener: (error?: Error) => void): () => void;
}

export interface RpcRequestOptions {
  signal?: AbortSignal;
  /** Bounds one RPC command/response exchange; it is not an assignment deadline. */
  timeoutMs?: number;
}

export interface RpcSettlementWaitOptions {
  signal?: AbortSignal;
  /** Resolve on the first settlement event after this sequence. Defaults to the current sequence. */
  afterSequence?: number;
}

export interface RpcClientOptions {
  redact?: RedactText;
}

export type RpcEventListener = (event: RpcEvent) => void;

interface PendingRequest {
  command: RpcCommandType;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  removeAbortListener: () => void;
}

interface SettlementWaiter {
  afterSequence: number;
  resolve: () => void;
  reject: (error: Error) => void;
  removeAbortListener: () => void;
}

export class RpcRequestError extends Error {
  readonly command: string;

  constructor(command: string, message: string) {
    super(`Pi RPC ${command} failed: ${message}`);
    this.name = "RpcRequestError";
    this.command = command;
  }
}

export class RpcRequestTimeoutError extends Error {
  constructor(
    readonly command: RpcCommandType,
    readonly timeoutMs: number,
  ) {
    super(`Pi RPC ${command} timed out after ${timeoutMs} milliseconds`);
    this.name = "RpcRequestTimeoutError";
  }
}

export class RpcClientClosedError extends Error {
  constructor(message = "Pi RPC transport closed") {
    super(message);
    this.name = "RpcClientClosedError";
  }
}

export class RpcProtocolViolationError extends Error {
  constructor(message: string) {
    super(`Pi RPC protocol violation: ${message}`);
    this.name = "RpcProtocolViolationError";
  }
}

export class PiRpcClient {
  private readonly decoder: JsonlDecoder;
  private readonly redact: RedactText;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<RpcEventListener>();
  private readonly settlementWaiters = new Set<SettlementWaiter>();
  private readonly removeTransportListeners: Array<() => void>;
  private nextRequestId = 0;
  private settlementSequence = 0;
  private closedError: Error | undefined;

  constructor(
    private readonly transport: RpcTransport,
    options: RpcClientOptions = {},
  ) {
    this.redact = options.redact ?? ((value) => value);
    this.decoder = new JsonlDecoder({ redact: this.redact });
    this.removeTransportListeners = [
      transport.onData((chunk) => this.receiveChunk(chunk)),
      transport.onClose((error) => this.receiveClose(error)),
    ];
  }

  onEvent(listener: RpcEventListener): () => void {
    this.throwIfClosed();
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  async request(command: RpcCommand, options: RpcRequestOptions = {}): Promise<RpcResponse> {
    this.throwIfClosed();
    if (options.signal?.aborted) throw abortError();
    const timeoutMs = normalizeTimeout(options.timeoutMs);

    const id = `subagent-rpc-${++this.nextRequestId}`;
    const payload = { ...command, id } as RpcCommand;

    return new Promise<RpcResponse>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const removeAbortListener = addAbortListener(options.signal, () => {
        this.pending.delete(id);
        if (timeout) clearTimeout(timeout);
        reject(abortError());
      });
      const cleanup = () => {
        removeAbortListener();
        if (timeout) clearTimeout(timeout);
      };
      this.pending.set(id, { command: command.type, resolve, reject, removeAbortListener: cleanup });
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          const pending = this.pending.get(id);
          if (!pending) return;
          this.pending.delete(id);
          pending.removeAbortListener();
          pending.reject(new RpcRequestTimeoutError(command.type, timeoutMs));
        }, timeoutMs);
        timeout.unref?.();
      }

      try {
        this.transport.write(encodeJsonl(payload as unknown as JsonObject));
      } catch (error) {
        this.pending.delete(id);
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async getState(options: RpcRequestOptions = {}): Promise<RpcSessionState> {
    const response = await this.successfulRequest({ type: "get_state" }, options);
    return parseSessionState(response.data);
  }

  async setModel(provider: string, modelId: string, options: RpcRequestOptions = {}): Promise<void> {
    await this.successfulRequest({ type: "set_model", provider, modelId }, options);
  }

  async setThinkingLevel(level: ReasoningEffort, options: RpcRequestOptions = {}): Promise<void> {
    await this.successfulRequest({ type: "set_thinking_level", level }, options);
  }

  async prompt(
    message: string,
    options: RpcRequestOptions & { streamingBehavior?: "steer" | "followUp" } = {},
  ): Promise<void> {
    const { streamingBehavior, ...requestOptions } = options;
    await this.successfulRequest({ type: "prompt", message, streamingBehavior }, requestOptions);
  }

  async steer(message: string, options: RpcRequestOptions = {}): Promise<void> {
    await this.successfulRequest({ type: "steer", message }, options);
  }

  async followUp(message: string, options: RpcRequestOptions = {}): Promise<void> {
    await this.successfulRequest({ type: "follow_up", message }, options);
  }

  async abort(options: RpcRequestOptions = {}): Promise<void> {
    await this.successfulRequest({ type: "abort" }, options);
  }

  async getLastAssistantText(options: RpcRequestOptions = {}): Promise<string | null> {
    const response = await this.successfulRequest({ type: "get_last_assistant_text" }, options);
    if (response.data === undefined || response.data === null) return null;
    const data = recordValue(response.data);
    if (!data) throw new RpcProtocolViolationError("get_last_assistant_text returned invalid data");
    if (data.text === undefined || data.text === null) return null;
    if (typeof data.text !== "string") {
      throw new RpcProtocolViolationError("get_last_assistant_text returned invalid data");
    }
    return data.text;
  }

  getSettlementSequence(): number {
    return this.settlementSequence;
  }

  waitForSettled(options: RpcSettlementWaitOptions = {}): Promise<void> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    this.throwIfClosed();
    const afterSequence = options.afterSequence ?? this.settlementSequence;
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      return Promise.reject(new RangeError("settlement sequence must be a non-negative safe integer"));
    }
    if (this.settlementSequence > afterSequence) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let waiter: SettlementWaiter;
      const removeAbortListener = addAbortListener(options.signal, () => {
        this.settlementWaiters.delete(waiter);
        reject(abortError());
      });
      waiter = { afterSequence, resolve, reject, removeAbortListener };
      this.settlementWaiters.add(waiter);
    });
  }

  close(reason: Error = new RpcClientClosedError()): void {
    if (this.closedError) return;
    this.closedError = reason;
    for (const remove of this.removeTransportListeners.splice(0)) remove();
    for (const request of this.pending.values()) {
      request.removeAbortListener();
      request.reject(reason);
    }
    this.pending.clear();
    for (const waiter of this.settlementWaiters) {
      waiter.removeAbortListener();
      waiter.reject(reason);
    }
    this.settlementWaiters.clear();
    this.eventListeners.clear();
  }

  private async successfulRequest(
    command: RpcCommand,
    options: RpcRequestOptions,
  ): Promise<RpcResponse & { success: true }> {
    const response = await this.request(command, options);
    if (!response.success) throw new RpcRequestError(response.command, this.redact(response.error));
    return response;
  }

  private receiveChunk(chunk: Uint8Array | string): void {
    if (this.closedError) return;
    try {
      for (const value of this.decoder.write(chunk)) this.receiveMessage(parseInboundMessage(value));
    } catch (error) {
      this.close(redactedError(error, this.redact));
    }
  }

  private receiveClose(error?: Error): void {
    if (this.closedError) return;
    try {
      for (const value of this.decoder.end()) this.receiveMessage(parseInboundMessage(value));
    } catch (decodeError) {
      this.close(redactedError(decodeError, this.redact));
      return;
    }
    this.close(error ?? new RpcClientClosedError());
  }

  private receiveMessage(message: RpcInboundMessage): void {
    if (isRpcResponse(message)) {
      this.receiveResponse(message);
      return;
    }

    if (isExtensionUiRequest(message) && isBlockingExtensionUiMethod(message.method)) {
      this.transport.write(encodeJsonl({ type: "extension_ui_response", id: message.id, cancelled: true }));
    }

    if (isAgentSettledEvent(message)) {
      this.settlementSequence += 1;
      for (const waiter of [...this.settlementWaiters]) {
        if (this.settlementSequence <= waiter.afterSequence) continue;
        this.settlementWaiters.delete(waiter);
        waiter.removeAbortListener();
        waiter.resolve();
      }
    }

    for (const listener of [...this.eventListeners]) listener(message);
  }

  private receiveResponse(response: RpcResponse): void {
    if (typeof response.id !== "string") {
      throw new RpcProtocolViolationError("response is missing its correlation id");
    }
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    request.removeAbortListener();

    if (response.command !== request.command) {
      const error = new RpcProtocolViolationError(
        this.redact(`response for ${request.command} claimed command ${response.command}`),
      );
      request.reject(error);
      this.close(error);
      return;
    }
    request.resolve(response);
  }

  private throwIfClosed(): void {
    if (this.closedError) throw this.closedError;
  }
}

function parseInboundMessage(value: JsonObject): RpcInboundMessage {
  if (typeof value.type !== "string") throw new RpcProtocolViolationError("record is missing a string type");
  if (value.type !== "response") return value as RpcInboundMessage;
  if (typeof value.command !== "string" || typeof value.success !== "boolean") {
    throw new RpcProtocolViolationError("malformed response");
  }
  if (value.id !== undefined && typeof value.id !== "string") {
    throw new RpcProtocolViolationError("response id must be a string");
  }
  if (value.success === false && typeof value.error !== "string") {
    throw new RpcProtocolViolationError("failed response is missing an error");
  }
  return value as unknown as RpcResponse;
}

function parseSessionState(value: unknown): RpcSessionState {
  const state = recordValue(value);
  const model = state ? recordValue(state.model) : undefined;
  if (
    !state ||
    (state.model !== null && (!model || typeof model.provider !== "string" || typeof model.id !== "string")) ||
    !isReasoningEffort(state.thinkingLevel) ||
    typeof state.isStreaming !== "boolean" ||
    typeof state.isCompacting !== "boolean" ||
    typeof state.sessionId !== "string" ||
    typeof state.pendingMessageCount !== "number" ||
    (state.sessionFile !== undefined && typeof state.sessionFile !== "string")
  ) {
    throw new RpcProtocolViolationError("get_state returned invalid data");
  }
  return {
    model: state.model === null ? null : { provider: model?.provider as string, id: model?.id as string },
    thinkingLevel: state.thinkingLevel,
    isStreaming: state.isStreaming,
    isCompacting: state.isCompacting,
    sessionId: state.sessionId,
    pendingMessageCount: state.pendingMessageCount,
    ...(typeof state.sessionFile === "string" ? { sessionFile: state.sessionFile } : {}),
  };
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max"
  );
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("RPC command timeout must be a positive safe integer");
  }
  return value;
}

function addAbortListener(signal: AbortSignal | undefined, listener: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener("abort", listener, { once: true });
  return () => signal.removeEventListener("abort", listener);
}

function redactedError(error: unknown, redact: RedactText): Error {
  const source = error instanceof Error ? error : new Error(String(error));
  const copy = new Error(redact(source.message));
  copy.name = source.name;
  return copy;
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

import { calculateCost, type ProviderHeaders, type Usage } from "@earendil-works/pi-ai";
import { codexReasoningEffort, resolveCodexResponsesUrl } from "./model";
import {
  CODEX_HTTP_MAX_RETRIES,
  CODEX_STREAM_IDLE_TIMEOUT_MS,
  CODEX_STREAM_MAX_RETRIES,
  retryAfterMs,
  retryDelayMs,
  sleepWithAbort,
} from "./retry";
import { isCodexCompactionItem } from "./state";
import type {
  CodexCompactionItem,
  CodexCompactionRetryClass,
  CodexRemoteCompactionResult,
  CodexRequestOptions,
  JsonObject,
} from "./types";

type CodexStreamReadResult = Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>;

export type CodexClientRuntime = {
  fetch: typeof fetch;
  sleep: typeof sleepWithAbort;
  random: () => number;
  streamIdleTimeoutMs: number;
};

export function createCodexClientRuntime(): CodexClientRuntime {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    sleep: sleepWithAbort,
    random: Math.random,
    streamIdleTimeoutMs: CODEX_STREAM_IDLE_TIMEOUT_MS,
  };
}

export async function fetchCodexCompaction(
  options: CodexRequestOptions,
  runtime: CodexClientRuntime = createCodexClientRuntime(),
): Promise<CodexRemoteCompactionResult> {
  const body = JSON.stringify(buildCodexCompactionBody(options));
  const headers = buildCodexHeaders(options);
  let requestAttempts = 0;

  for (let streamAttempt = 0; streamAttempt <= CODEX_STREAM_MAX_RETRIES; streamAttempt += 1) {
    let result: CodexRemoteCompactionResult | undefined;

    for (let transportAttempt = 0; transportAttempt <= CODEX_HTTP_MAX_RETRIES; transportAttempt += 1) {
      requestAttempts += 1;
      result = await fetchCodexCompactionAttempt(options, body, headers, runtime);
      if (result.ok || result.retryClass !== "transport") break;
      if (transportAttempt === CODEX_HTTP_MAX_RETRIES) break;

      try {
        await runtime.sleep(retryDelayMs(transportAttempt + 1, runtime.random), options.signal);
      } catch (error) {
        return abortedResult(error, requestAttempts, streamAttempt + 1);
      }
    }

    if (!result) throw new Error("Codex compaction retry loop produced no result");
    if (result.ok) return result;
    if (result.aborted || result.retryClass === "terminal") {
      return withAttemptMetadata(result, requestAttempts, streamAttempt + 1, false);
    }
    if (streamAttempt === CODEX_STREAM_MAX_RETRIES) {
      return withAttemptMetadata(result, requestAttempts, streamAttempt + 1, true);
    }

    const delay = result.retryAfterMs ?? retryDelayMs(streamAttempt + 1, runtime.random);
    try {
      await runtime.sleep(delay, options.signal);
    } catch (error) {
      return abortedResult(error, requestAttempts, streamAttempt + 1);
    }
  }

  throw new Error("Codex compaction retry loop exhausted without a result");
}

async function fetchCodexCompactionAttempt(
  options: CodexRequestOptions,
  body: string,
  headers: Headers,
  runtime: CodexClientRuntime,
): Promise<CodexRemoteCompactionResult> {
  if (options.signal?.aborted) return abortedResult(undefined);

  let response: Response;
  try {
    response = await runtime.fetch(resolveCodexResponsesUrl(options.model.baseUrl), {
      method: "POST",
      headers,
      body,
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) return abortedResult(error);
    return failure(errorMessage(error), "transport");
  }

  const retryDelay = retryAfterMs(response.headers);
  let text: string;
  try {
    text = await readResponseText(response, runtime.streamIdleTimeoutMs, options.signal);
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) return abortedResult(error);
    return failure(errorMessage(error), response.status >= 500 ? "transport" : "stream", retryDelay);
  }

  if (!response.ok) {
    return failure(
      responseErrorText(response.status, text),
      httpRetryClass(response.status, response.headers),
      retryDelay,
      response.status,
    );
  }

  const result = parseCompactionStream(text, options);
  if (!result.ok && retryDelay !== undefined && result.retryAfterMs === undefined) {
    return { ...result, retryAfterMs: retryDelay };
  }
  return result;
}

export function buildCodexCompactionBody(options: CodexRequestOptions): JsonObject {
  const input = [...options.input, { type: "compaction_trigger" }];
  const reasoningEffort = codexReasoningEffort(options.model, options.thinkingLevel);
  const body: JsonObject = {
    model: options.model.id,
    store: false,
    stream: true,
    instructions: options.systemPrompt || "You are a helpful assistant.",
    input,
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    tool_choice: "auto",
    parallel_tool_calls: true,
  };

  const sessionKey = stableSessionKey(options.sessionId);
  if (sessionKey) body.prompt_cache_key = sessionKey;
  if (options.tools && options.tools.length > 0) body.tools = options.tools;
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort, summary: "auto" };
  return body;
}

export function parseSseEvents(text: string): JsonObject[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const events: JsonObject[] = [];

  for (const block of normalized.split(/\n\n+/)) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as unknown;
      if (isJsonObject(parsed)) events.push(parsed);
    } catch {
      // A missing valid terminal event below classifies malformed/incomplete streams as retryable.
    }
  }
  return events;
}

export function parseCompactionStream(
  text: string,
  options: Pick<CodexRequestOptions, "model">,
): CodexRemoteCompactionResult {
  const events = parseSseEvents(text);

  for (const event of events) {
    if (event.type === "response.failed" || event.type === "error") {
      const meta = extractTerminalMeta(event, options.model);
      return { ...failure(streamFailureReason(event), streamFailureRetryClass(event)), ...meta };
    }
    if (event.type === "response.incomplete") {
      const meta = extractTerminalMeta(event, options.model);
      return { ...failure("Codex compaction stream ended with response.incomplete", "stream"), ...meta };
    }
  }

  const completed = events.find((event) => event.type === "response.completed");
  if (!completed) return failure("Codex compaction stream missing response.completed", "stream");

  const completedResponse = isJsonObject(completed.response) ? completed.response : undefined;
  const responseId =
    (typeof completedResponse?.id === "string" && completedResponse.id) ||
    (typeof completed.id === "string" ? completed.id : undefined);
  const usage = convertRemoteUsage(completedResponse?.usage, options.model);

  if (completedResponse?.status !== "completed") {
    return {
      ...failure(
        `Codex compaction completed with status ${String(completedResponse?.status ?? "missing")}`,
        "terminal",
      ),
      responseId,
      usage,
    };
  }

  const compactionItems = events
    .filter((event) => event.type === "response.output_item.done" && isJsonObject(event.item))
    .map((event) => event.item)
    .filter(isCodexCompactionItem);

  if (compactionItems.length !== 1) {
    return {
      ...failure(`expected exactly one compaction item, got ${compactionItems.length}`, "terminal"),
      responseId,
      usage,
    };
  }

  return { ok: true, item: compactionItems[0] as CodexCompactionItem, responseId, usage };
}

export function convertRemoteUsage(raw: unknown, model: CodexRequestOptions["model"]): Usage | undefined {
  if (!isJsonObject(raw)) return undefined;
  const cachedTokens =
    isJsonObject(raw.input_tokens_details) && typeof raw.input_tokens_details.cached_tokens === "number"
      ? raw.input_tokens_details.cached_tokens
      : 0;
  const cacheWriteTokens =
    isJsonObject(raw.input_tokens_details) && typeof raw.input_tokens_details.cache_write_tokens === "number"
      ? raw.input_tokens_details.cache_write_tokens
      : 0;
  const inputTokens = typeof raw.input_tokens === "number" ? raw.input_tokens : 0;
  const outputTokens = typeof raw.output_tokens === "number" ? raw.output_tokens : 0;
  const reasoningTokens =
    isJsonObject(raw.output_tokens_details) && typeof raw.output_tokens_details.reasoning_tokens === "number"
      ? raw.output_tokens_details.reasoning_tokens
      : undefined;
  const totalTokens = typeof raw.total_tokens === "number" ? raw.total_tokens : inputTokens + outputTokens;
  const usage: Usage = {
    input: Math.max(0, inputTokens - cachedTokens - cacheWriteTokens),
    output: outputTokens,
    cacheRead: cachedTokens,
    cacheWrite: cacheWriteTokens,
    ...(reasoningTokens !== undefined ? { reasoning: reasoningTokens } : {}),
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  usage.cost = calculateCost(model, usage);
  return usage;
}

async function readResponseText(response: Response, idleTimeoutMs: number, signal?: AbortSignal): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (true) {
      const chunk = await readChunk(reader, idleTimeoutMs, signal);
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<CodexStreamReadResult> {
  if (signal?.aborted) return Promise.reject(new DOMException("The operation was aborted", "AbortError"));

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () => finish(new DOMException("Codex compaction stream idle timeout", "TimeoutError")),
      idleTimeoutMs,
    );

    const abort = () => finish(new DOMException("The operation was aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });

    reader.read().then(
      (result) => finish(undefined, result),
      (error) => finish(error),
    );

    function finish(error?: unknown, result?: CodexStreamReadResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) {
        void reader.cancel(error).catch(() => undefined);
        reject(error);
      } else if (result) resolve(result);
    }
  });
}

function extractTerminalMeta(
  event: JsonObject,
  model: CodexRequestOptions["model"],
): { responseId?: string; usage?: Usage } {
  const response = isJsonObject(event.response) ? event.response : undefined;
  const responseId =
    (response && typeof response.id === "string" && response.id) ||
    (typeof event.id === "string" ? event.id : undefined);
  return { responseId, usage: convertRemoteUsage(response?.usage, model) };
}

function buildCodexHeaders(options: CodexRequestOptions): Headers {
  const headers = new Headers();
  applyProviderHeaders(headers, options.model.headers);
  applyProviderHeaders(headers, options.headers);
  headers.set("Authorization", `Bearer ${options.apiKey}`);
  headers.set("chatgpt-account-id", options.accountId);
  headers.set("originator", "pi");
  headers.set("User-Agent", "pi-codex-compaction-extension");
  headers.set("OpenAI-Beta", "responses=experimental");
  headers.set("accept", "text/event-stream");
  headers.set("content-type", "application/json");

  const sessionKey = stableSessionKey(options.sessionId);
  if (sessionKey) {
    headers.set("session-id", sessionKey);
    headers.set("x-client-request-id", sessionKey);
  }
  return headers;
}

function applyProviderHeaders(headers: Headers, values: ProviderHeaders | undefined): void {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === null) headers.delete(key);
    else headers.set(key, value);
  }
}

function stableSessionKey(sessionId: string | undefined): string | undefined {
  if (!sessionId || sessionId.trim().length === 0) return undefined;
  return sessionId.length <= 64 ? sessionId : sessionId.slice(0, 64);
}

function httpRetryClass(status: number, headers: Headers): CodexCompactionRetryClass {
  if (status >= 500) return "transport";
  const shouldRetry = headers.get("x-should-retry")?.toLowerCase();
  if (shouldRetry === "true") return "stream";
  if (shouldRetry === "false") return "terminal";
  if (status === 400 || status === 429) return "terminal";
  return "stream";
}

function streamFailureRetryClass(event: JsonObject): CodexCompactionRetryClass {
  const error = isJsonObject(event.error)
    ? event.error
    : isJsonObject(event.response) && isJsonObject(event.response.error)
      ? event.response.error
      : undefined;
  const code = typeof error?.code === "string" ? error.code.toLowerCase() : "";
  const type = typeof error?.type === "string" ? error.type.toLowerCase() : "";
  const terminal = [
    "context_length",
    "invalid_request",
    "insufficient_quota",
    "usage_limit",
    "usage_not_included",
    "policy",
  ];
  return terminal.some((value) => code.includes(value) || type.includes(value)) ? "terminal" : "stream";
}

function failure(
  reason: string,
  retryClass: CodexCompactionRetryClass,
  retryDelay?: number,
  status?: number,
): Extract<CodexRemoteCompactionResult, { ok: false }> {
  return {
    ok: false,
    reason,
    retryClass,
    ...(retryDelay !== undefined ? { retryAfterMs: retryDelay } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

function withAttemptMetadata(
  result: Extract<CodexRemoteCompactionResult, { ok: false }>,
  requestAttempts: number,
  streamAttempts: number,
  exhausted: boolean,
): CodexRemoteCompactionResult {
  return { ...result, requestAttempts, streamAttempts, ...(exhausted ? { exhausted: true } : {}) };
}

function abortedResult(
  error?: unknown,
  requestAttempts?: number,
  streamAttempts?: number,
): Extract<CodexRemoteCompactionResult, { ok: false }> {
  return {
    ok: false,
    reason: isAbortError(error) ? "Codex compaction aborted" : errorMessage(error ?? "Codex compaction aborted"),
    retryClass: "terminal",
    aborted: true,
    ...(requestAttempts !== undefined ? { requestAttempts } : {}),
    ...(streamAttempts !== undefined ? { streamAttempts } : {}),
  };
}

function responseErrorText(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; code?: string } };
    const message = parsed.error?.message ?? body;
    const code = parsed.error?.code ? ` (${parsed.error.code})` : "";
    return `Codex compaction failed with HTTP ${status}: ${message}${code}`;
  } catch {
    return `Codex compaction failed with HTTP ${status}: ${body.slice(0, 500)}`;
  }
}

function streamFailureReason(event: JsonObject): string {
  if (isJsonObject(event.error) && typeof event.error.message === "string") {
    return `Codex compaction stream failed: ${event.error.message}`;
  }
  if (
    isJsonObject(event.response) &&
    isJsonObject(event.response.error) &&
    typeof event.response.error.message === "string"
  ) {
    return `Codex compaction stream failed: ${event.response.error.message}`;
  }
  return `Codex compaction stream failed with ${String(event.type)}`;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || message.toLowerCase().includes("abort");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

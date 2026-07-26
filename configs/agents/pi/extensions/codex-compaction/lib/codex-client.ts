import { calculateCost, type Usage } from "@earendil-works/pi-ai";
import { codexReasoningEffort, resolveCodexResponsesUrl } from "./model";
import { isCodexCompactionItem } from "./state";
import type { CodexCompactionFetchResult, CodexCompactionItem, CodexRequestOptions, JsonObject } from "./types";

export async function fetchCodexCompaction(options: CodexRequestOptions): Promise<CodexCompactionFetchResult> {
  try {
    const body = buildCodexCompactionBody(options);
    const response = await fetch(resolveCodexResponsesUrl(options.model.baseUrl), {
      method: "POST",
      headers: buildCodexHeaders(options),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      return { ok: false, reason: responseErrorText(response.status, text) };
    }

    return parseCompactionStream(text, options);
  } catch (error) {
    if (isAbortError(error) || options.signal?.aborted) {
      return { ok: false, reason: "aborted", aborted: true };
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
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
  if (sessionKey) {
    body.prompt_cache_key = sessionKey;
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort, summary: "auto" };
  }

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
      // Ignore malformed event chunks; terminal validation reports failure.
    }
  }

  return events;
}

export function parseCompactionStream(
  text: string,
  options: Pick<CodexRequestOptions, "model">,
): CodexCompactionFetchResult {
  const events = parseSseEvents(text);

  for (const event of events) {
    if (event.type === "response.failed" || event.type === "error") {
      const meta = extractTerminalMeta(event, options.model);
      return { ok: false, reason: streamFailureReason(event), ...meta };
    }
    if (event.type === "response.incomplete") {
      const meta = extractTerminalMeta(event, options.model);
      return { ok: false, reason: "Codex compaction stream ended with response.incomplete", ...meta };
    }
  }

  const completed = events.find((event) => event.type === "response.completed");
  if (!completed) {
    return { ok: false, reason: "Codex compaction stream missing response.completed" };
  }

  const completedResponse = isJsonObject(completed.response) ? completed.response : undefined;
  const responseId =
    (typeof completedResponse?.id === "string" && completedResponse.id) ||
    (typeof completed.id === "string" ? completed.id : undefined);
  const usage = convertRemoteUsage(completedResponse?.usage, options.model);

  // Require explicit completed status — not cancelled/queued/in_progress/missing.
  if (completedResponse?.status !== "completed") {
    return {
      ok: false,
      reason: `Codex compaction completed with status ${String(completedResponse?.status ?? "missing")}`,
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
      ok: false,
      reason: `expected exactly one compaction item, got ${compactionItems.length}`,
      responseId,
      usage,
    };
  }

  return {
    ok: true,
    item: compactionItems[0] as CodexCompactionItem,
    responseId,
    usage,
  };
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

function extractTerminalMeta(
  event: JsonObject,
  model: CodexRequestOptions["model"],
): { responseId?: string; usage?: Usage } {
  const response = isJsonObject(event.response) ? event.response : undefined;
  const responseId =
    (response && typeof response.id === "string" && response.id) ||
    (typeof event.id === "string" ? event.id : undefined);
  const usage = convertRemoteUsage(response?.usage, model);
  return { responseId, usage };
}

function buildCodexHeaders(options: CodexRequestOptions): Headers {
  const headers = new Headers(options.model.headers);
  for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);

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

function stableSessionKey(sessionId: string | undefined): string | undefined {
  if (!sessionId || sessionId.trim().length === 0) return undefined;
  return sessionId.length <= 64 ? sessionId : sessionId.slice(0, 64);
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

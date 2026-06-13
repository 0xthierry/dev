import { codexReasoningEffort, resolveCodexResponsesUrl } from "./model";
import type { CodexCompactionFetchResult, CodexCompactionItem, CodexRequestOptions, JsonObject } from "./types";

export async function fetchCodexCompaction(options: CodexRequestOptions): Promise<CodexCompactionFetchResult> {
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

  const events = parseSseEvents(text);
  const compactionItems = events
    .filter((event) => event.type === "response.output_item.done" && isJsonObject(event.item))
    .map((event) => event.item)
    .filter(isCodexCompactionItem);

  if (compactionItems.length !== 1) {
    return { ok: false, reason: `expected exactly one compaction item, got ${compactionItems.length}` };
  }

  return { ok: true, item: compactionItems[0] };
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
    prompt_cache_key: shortPromptCacheKey(),
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
  }

  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort, summary: "auto" };
  }

  return body;
}

export function parseSseEvents(text: string): JsonObject[] {
  const events: JsonObject[] = [];

  for (const block of text.split(/\n\n+/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    if (!data || data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as unknown;
      if (isJsonObject(parsed)) events.push(parsed);
    } catch {
      // Ignore malformed event chunks; the final item count check reports failure.
    }
  }

  return events;
}

export function isCodexCompactionItem(value: unknown): value is CodexCompactionItem {
  return (
    isJsonObject(value) &&
    value.type === "compaction" &&
    typeof value.encrypted_content === "string" &&
    value.encrypted_content.length > 0 &&
    (value.id === undefined || typeof value.id === "string")
  );
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

  return headers;
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

function shortPromptCacheKey(): string {
  return `picomp-${crypto.randomUUID().slice(0, 12)}`;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

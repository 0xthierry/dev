import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildCodexCompactionBody, fetchCodexCompaction, parseSseEvents } from "./codex-client";
import type { CodexModel } from "./types";

const originalFetch = globalThis.fetch;

const model = {
  id: "gpt-5.4-mini",
  provider: "openai-codex",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  headers: {},
  reasoning: true,
  thinkingLevelMap: { minimal: "low" },
} as CodexModel;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("codex client", () => {
  test("builds a compaction trigger request body", () => {
    // Arrange
    const input = [{ role: "user", content: "remember alpha" }];

    // Act
    const body = buildCodexCompactionBody({
      model,
      apiKey: "token",
      accountId: "acct",
      systemPrompt: "system",
      input,
      tools: [{ type: "function", name: "read", description: "Read files", parameters: {}, strict: false }],
      thinkingLevel: "minimal",
    });

    // Assert
    expect(body.input).toEqual([...input, { type: "compaction_trigger" }]);
    expect(body.tools).toEqual([
      { type: "function", name: "read", description: "Read files", parameters: {}, strict: false },
    ]);
    expect(body.reasoning).toEqual({ effort: "low", summary: "auto" });
    expect(body.prompt_cache_key).toBeString();
    expect((body.prompt_cache_key as string).length).toBeLessThanOrEqual(64);
  });

  test("parses SSE events", () => {
    // Arrange
    const text = ['data: {"type":"one"}', "", 'data: {"type":"two"}', ""].join("\n");

    // Act
    const events = parseSseEvents(text);

    // Assert
    expect(events).toEqual([{ type: "one" }, { type: "two" }]);
  });

  test("returns the single compaction item from the Codex stream", async () => {
    // Arrange
    const body = [
      'data: {"type":"response.output_item.added","item":{"type":"compaction"}}',
      "",
      'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
      "",
      'data: {"type":"response.completed","response":{"status":"completed"}}',
      "",
    ].join("\n");
    globalThis.fetch = mock(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await fetchCodexCompaction({
      model,
      apiKey: "token",
      accountId: "acct",
      systemPrompt: "system",
      input: [{ role: "user", content: "remember alpha" }],
      thinkingLevel: "low",
    });

    // Assert
    expect(result).toEqual({ ok: true, item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildCodexCompactionBody, fetchCodexCompaction, parseCompactionStream, parseSseEvents } from "./codex-client";
import type { CodexModel } from "./types";

const originalFetch = globalThis.fetch;

const model = {
  id: "gpt-5.6-sol",
  provider: "openai-codex",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  headers: {},
  reasoning: true,
  thinkingLevelMap: { minimal: "low" },
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
  contextWindow: 200000,
  maxTokens: 32000,
  name: "sol",
} as CodexModel;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("codex client", () => {
  test("builds a compaction trigger body with stable session cache key", () => {
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
      sessionId: "session-abc-123",
    });

    // Assert
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.input).toEqual([...input, { type: "compaction_trigger" }]);
    expect(body.prompt_cache_key).toBe("session-abc-123");
  });

  test("parses LF and CRLF SSE events", () => {
    // Arrange
    const lf = ['data: {"type":"one"}', "", 'data: {"type":"two"}', ""].join("\n");
    const crlf = ['data: {"type":"one"}', "", 'data: {"type":"two"}', ""].join("\r\n");

    // Act / Assert
    expect(parseSseEvents(lf)).toEqual([{ type: "one" }, { type: "two" }]);
    expect(parseSseEvents(crlf)).toEqual([{ type: "one" }, { type: "two" }]);
  });

  test("requires response.completed with status completed and exactly one compaction item", () => {
    // Arrange
    const missingCompleted = [
      'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
      "",
    ].join("\n");
    const completed = [
      'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
      "",
      'data: {"type":"response.completed","response":{"id":"resp_9","status":"completed","usage":{"input_tokens":11,"output_tokens":2,"total_tokens":13,"input_tokens_details":{"cached_tokens":1}}}}',
      "",
    ].join("\n");

    // Act
    const failed = parseCompactionStream(missingCompleted, { model });
    const ok = parseCompactionStream(completed, { model });

    // Assert
    expect(failed).toEqual({ ok: false, reason: "Codex compaction stream missing response.completed" });
    expect(ok).toMatchObject({
      ok: true,
      item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      responseId: "resp_9",
    });
    if (ok.ok) {
      expect(ok.usage?.input).toBe(10);
      expect(ok.usage?.cacheRead).toBe(1);
    }
  });

  test("rejects non-completed terminal statuses while preserving responseId/usage", () => {
    // Arrange
    const statuses = ["cancelled", "queued", "in_progress", "failed", "incomplete"];

    // Act
    const results = statuses.map((status) =>
      parseCompactionStream(
        [
          'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
          "",
          `data: {"type":"response.completed","response":{"id":"resp_${status}","status":"${status}","usage":{"input_tokens":5,"output_tokens":0,"total_tokens":5}}}`,
          "",
        ].join("\n"),
        { model },
      ),
    );

    // Assert
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.responseId).toStartWith("resp_");
        expect(result.usage?.input).toBe(5);
      }
    }
  });

  test("billed zero/two artifact failures preserve usage", () => {
    // Arrange
    const zero = [
      'data: {"type":"response.completed","response":{"id":"resp_0","status":"completed","usage":{"input_tokens":8,"output_tokens":0,"total_tokens":8}}}',
      "",
    ].join("\n");
    const two = [
      'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"a","id":"1"}}',
      "",
      'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"b","id":"2"}}',
      "",
      'data: {"type":"response.completed","response":{"id":"resp_2","status":"completed","usage":{"input_tokens":9,"output_tokens":1,"total_tokens":10}}}',
      "",
    ].join("\n");

    // Act
    const zeroResult = parseCompactionStream(zero, { model });
    const twoResult = parseCompactionStream(two, { model });

    // Assert
    expect(zeroResult).toMatchObject({
      ok: false,
      reason: "expected exactly one compaction item, got 0",
      responseId: "resp_0",
    });
    expect(twoResult).toMatchObject({
      ok: false,
      reason: "expected exactly one compaction item, got 2",
      responseId: "resp_2",
    });
    if (!zeroResult.ok) expect(zeroResult.usage?.input).toBe(8);
    if (!twoResult.ok) expect(twoResult.usage?.input).toBe(9);
  });

  test("rejects failed, error, and incomplete streams", () => {
    // Arrange
    const cases = [
      ['data: {"type":"response.failed","response":{"error":{"message":"nope"}}}', ""].join("\n"),
      ['data: {"type":"error","error":{"message":"boom"}}', ""].join("\n"),
      [
        'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
        "",
        'data: {"type":"response.incomplete"}',
        "",
      ].join("\n"),
    ];

    // Act
    const results = cases.map((text) => parseCompactionStream(text, { model }));

    // Assert
    expect(results.every((result) => result.ok === false)).toBe(true);
  });

  test("fetch sets stable session headers and returns responseId + usage", async () => {
    // Arrange
    const body = [
      'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
      "",
      'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":5,"output_tokens":1,"total_tokens":6}}}',
      "",
    ].join("\n");
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("session-id")).toBe("sess-1");
      expect(headers.get("x-client-request-id")).toBe("sess-1");
      return new Response(body, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await fetchCodexCompaction({
      model,
      apiKey: "token",
      accountId: "acct",
      systemPrompt: "system",
      input: [{ role: "user", content: "remember alpha" }],
      thinkingLevel: "low",
      sessionId: "sess-1",
    });

    // Assert
    expect(result).toMatchObject({
      ok: true,
      item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      responseId: "resp_1",
    });
  });
});

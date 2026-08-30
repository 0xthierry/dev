import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  buildCodexCompactionBody,
  type CodexClientRuntime,
  fetchCodexCompaction,
  parseCompactionStream,
  parseSseEvents,
} from "./codex-client";
import type { CodexModel, CodexRequestOptions } from "./types";

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
    expect(failed).toEqual({
      ok: false,
      reason: "Codex compaction stream missing response.completed",
      retryClass: "stream",
    });
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

  test("applies provider header overrides and null deletions", async () => {
    // Arrange
    const modelWithHeaders = {
      ...model,
      headers: { "x-keep": "model-value", "x-remove": "model-value" },
    } as CodexModel;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-keep")).toBe("resolved-value");
      expect(headers.has("x-remove")).toBe(false);
      return new Response("", { status: 400 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    await fetchCodexCompaction({
      model: modelWithHeaders,
      apiKey: "token",
      headers: { "x-keep": "resolved-value", "x-remove": null },
      accountId: "acct",
      systemPrompt: "system",
      input: [{ role: "user", content: "remember alpha" }],
      thinkingLevel: "low",
    });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("fetch sets stable session headers and returns responseId + usage without retry", async () => {
    // Arrange
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("session-id")).toBe("sess-1");
      expect(headers.get("x-client-request-id")).toBe("sess-1");
      return completedResponse();
    });
    const sleep = mock(async () => undefined);

    // Act
    const result = await fetchCodexCompaction(requestOptions(), clientRuntime(fetchMock, sleep));

    // Assert
    expect(result).toMatchObject({
      ok: true,
      item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      responseId: "resp_1",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("retries a transport exception and HTTP 5xx before succeeding", async () => {
    // Arrange
    const fetchMock = mock(async () => completedResponse());
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError("connection reset");
    });
    fetchMock.mockImplementationOnce(async () => new Response("server error", { status: 503 }));
    const sleep = mock(async () => undefined);

    // Act
    const result = await fetchCodexCompaction(requestOptions(), clientRuntime(fetchMock, sleep));

    // Assert
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("retries incomplete and missing-terminal streams at the outer compaction layer", async () => {
    // Arrange
    const fetchMock = mock(async () => completedResponse());
    fetchMock.mockImplementationOnce(async () => new Response('data: {"type":"response.incomplete"}\n\n'));
    fetchMock.mockImplementationOnce(async () => new Response('data: {"type":"response.created"}\n\n'));
    const sleep = mock(async () => undefined);

    // Act
    const result = await fetchCodexCompaction(requestOptions(), clientRuntime(fetchMock, sleep));

    // Assert
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  test("uses Retry-After for an outer retry", async () => {
    // Arrange
    const fetchMock = mock(async () => completedResponse());
    fetchMock.mockImplementationOnce(
      async () => new Response("request timeout", { status: 408, headers: { "retry-after": "2.5" } }),
    );
    const sleep = mock(async () => undefined);

    // Act
    const result = await fetchCodexCompaction(requestOptions(), clientRuntime(fetchMock, sleep));

    // Assert
    expect(result.ok).toBe(true);
    expect(sleep).toHaveBeenCalledWith(2500, undefined);
  });

  test("retries after the Codex-style stream inactivity timeout", async () => {
    // Arrange
    const fetchMock = mock(async () => completedResponse());
    fetchMock.mockImplementationOnce(
      async () => new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 200 }),
    );
    const sleep = mock(async () => undefined);
    const runtime = { ...clientRuntime(fetchMock, sleep), streamIdleTimeoutMs: 5 };

    // Act
    const result = await fetchCodexCompaction(requestOptions(), runtime);

    // Assert
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  test("does not retry terminal HTTP or malformed completed artifacts", async () => {
    // Arrange
    const malformed = [
      'data: {"type":"response.completed","response":{"id":"resp_bad","status":"completed"}}',
      "",
    ].join("\n");
    const badRequestFetch = mock(async () => new Response("bad input", { status: 400 }));
    const malformedFetch = mock(async () => new Response(malformed));
    const sleep = mock(async () => undefined);

    // Act
    const badRequest = await fetchCodexCompaction(requestOptions(), clientRuntime(badRequestFetch, sleep));
    const malformedResult = await fetchCodexCompaction(requestOptions(), clientRuntime(malformedFetch, sleep));

    // Assert
    expect(badRequest).toMatchObject({ ok: false, retryClass: "terminal", requestAttempts: 1 });
    expect(malformedResult).toMatchObject({ ok: false, retryClass: "terminal", requestAttempts: 1 });
    expect(badRequestFetch).toHaveBeenCalledTimes(1);
    expect(malformedFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  test("bounds compounded transport and stream retries", async () => {
    // Arrange
    const fetchMock = mock(async () => {
      throw new TypeError("network unavailable");
    });
    const sleep = mock(async () => undefined);

    // Act
    const result = await fetchCodexCompaction(requestOptions(), clientRuntime(fetchMock, sleep));

    // Assert
    expect(result).toMatchObject({
      ok: false,
      retryClass: "transport",
      requestAttempts: 15,
      streamAttempts: 3,
      exhausted: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(sleep).toHaveBeenCalledTimes(14);
  });

  test("aborts during request or backoff without another attempt", async () => {
    // Arrange
    const requestAbort = mock(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const controller = new AbortController();
    const retryableFetch = mock(async () => new Response("timeout", { status: 408 }));
    const abortingSleep = mock(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    // Act
    const duringRequest = await fetchCodexCompaction(requestOptions(), clientRuntime(requestAbort));
    const duringBackoff = await fetchCodexCompaction(
      requestOptions({ signal: controller.signal }),
      clientRuntime(retryableFetch, abortingSleep),
    );

    // Assert
    expect(duringRequest).toMatchObject({ ok: false, aborted: true, requestAttempts: 1 });
    expect(duringBackoff).toMatchObject({ ok: false, aborted: true, requestAttempts: 1 });
    expect(requestAbort).toHaveBeenCalledTimes(1);
    expect(retryableFetch).toHaveBeenCalledTimes(1);
  });
});

function requestOptions(overrides: Partial<CodexRequestOptions> = {}): CodexRequestOptions {
  return {
    model,
    apiKey: "token",
    accountId: "acct",
    systemPrompt: "system",
    input: [{ role: "user", content: "remember alpha" }],
    thinkingLevel: "low",
    sessionId: "sess-1",
    ...overrides,
  };
}

function completedResponse(): Response {
  const body = [
    'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
    "",
    'data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":5,"output_tokens":1,"total_tokens":6}}}',
    "",
  ].join("\n");
  return new Response(body, { status: 200 });
}

function clientRuntime(
  fetchMock: ReturnType<typeof mock>,
  sleep: ReturnType<typeof mock> = mock(async () => undefined),
): CodexClientRuntime {
  return {
    fetch: fetchMock as unknown as typeof fetch,
    sleep: sleep as unknown as CodexClientRuntime["sleep"],
    random: () => 0.5,
    streamIdleTimeoutMs: 300_000,
  };
}

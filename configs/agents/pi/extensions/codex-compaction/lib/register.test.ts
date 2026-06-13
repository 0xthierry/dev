import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerCodexCompactionExtension } from "./register";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("registerCodexCompactionExtension", () => {
  test("overrides Codex compaction with an opaque compaction result", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi);
    globalThis.fetch = mock(async () => new Response(compactionSse(), { status: 200 })) as unknown as typeof fetch;

    const model = {
      id: "gpt-5.4-mini",
      provider: "openai-codex",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
      headers: {},
      reasoning: true,
      thinkingLevelMap: { minimal: "low" },
    };

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      {
        type: "session_before_compact",
        preparation: {
          firstKeptEntryId: "kept",
          messagesToSummarize: [{ role: "user", content: "remember alpha", timestamp: 1 }],
          turnPrefixMessages: [],
          tokensBefore: 100,
        },
        branchEntries: [],
        signal: undefined,
      },
      {
        model,
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: jwtWithAccountId("acct_123") })) },
        getSystemPrompt: () => "system",
      },
    );

    // Assert
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      compaction: {
        firstKeptEntryId: "kept",
        tokensBefore: 100,
        details: {
          codexCompaction: {
            item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
          },
        },
      },
    });
    expect(JSON.stringify(results[0])).toContain("pi-codex-compaction:");
  });

  test("falls back to Pi compaction for an empty small-session span with multiple user turns", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi);
    const fetchMock = mock(async () => new Response(compactionSse(), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const model = {
      id: "gpt-5.4-mini",
      provider: "openai-codex",
      api: "openai-codex-responses",
      baseUrl: "https://chatgpt.com/backend-api",
      headers: {},
      reasoning: true,
      thinkingLevelMap: { minimal: "low" },
    };
    const branch = [
      messageEntry("u1", { role: "user", content: "remember alpha", timestamp: 1 }),
      messageEntry("a1", assistantText("ok")),
      messageEntry("u2", { role: "user", content: "continue", timestamp: 3 }),
    ];

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      {
        type: "session_before_compact",
        preparation: {
          firstKeptEntryId: "u1",
          messagesToSummarize: [],
          turnPrefixMessages: [],
          tokensBefore: 80,
        },
        branchEntries: branch,
        signal: undefined,
      },
      {
        model,
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: jwtWithAccountId("acct_123") })) },
        getSystemPrompt: () => "system",
      },
    );

    // Assert
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falls back to Pi compaction for an empty small-session span with fewer than two user turns", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi);
    const fetchMock = mock(async () => new Response(compactionSse(), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      {
        type: "session_before_compact",
        preparation: {
          firstKeptEntryId: "u1",
          messagesToSummarize: [],
          turnPrefixMessages: [],
          tokensBefore: 80,
        },
        branchEntries: [messageEntry("u1", { role: "user", content: "remember alpha", timestamp: 1 })],
        signal: undefined,
      },
      {
        model: {
          id: "gpt-5.4-mini",
          provider: "openai-codex",
          api: "openai-codex-responses",
          baseUrl: "https://chatgpt.com/backend-api",
          headers: {},
          reasoning: true,
          thinkingLevelMap: { minimal: "low" },
        },
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: jwtWithAccountId("acct_123") })) },
        getSystemPrompt: () => "system",
      },
    );

    // Assert
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("falls back to Pi compaction when previous opaque compaction was invalidated", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi);
    const fetchMock = mock(async () => new Response(compactionSse(), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const branch = [
      codexCompactionBranchEntry("pi-codex-compaction:test"),
      {
        type: "custom",
        id: "invalidate",
        parentId: "cmp-entry",
        timestamp: new Date(1).toISOString(),
        customType: "codex-compaction-invalidated",
        data: { sentinel: "pi-codex-compaction:test", status: 400 },
      },
    ];

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      {
        type: "session_before_compact",
        preparation: {
          firstKeptEntryId: "kept-2",
          messagesToSummarize: [{ role: "user", content: "remember beta", timestamp: 2 }],
          turnPrefixMessages: [],
          tokensBefore: 200,
        },
        branchEntries: branch,
        signal: undefined,
      },
      {
        model: {
          id: "gpt-5.4-mini",
          provider: "openai-codex",
          api: "openai-codex-responses",
          baseUrl: "https://chatgpt.com/backend-api",
          headers: {},
          reasoning: true,
          thinkingLevelMap: { minimal: "low" },
        },
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: jwtWithAccountId("acct_123") })) },
        getSystemPrompt: () => "system",
      },
    );

    // Assert
    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not invalidate injected compaction after a transient provider response", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi);
    const branch = [codexCompactionBranchEntry("pi-codex-compaction:test")];
    const payload = { input: [{ role: "user", content: "pi-codex-compaction:test" }] };

    // Act
    await fakePi.emit(
      "before_provider_request",
      { type: "before_provider_request", payload },
      contextWithBranch(branch),
    );
    await fakePi.emit(
      "after_provider_response",
      { type: "after_provider_response", status: 429, headers: {} },
      contextWithBranch(branch),
    );

    // Assert
    expect(fakePi.appendedEntries).toEqual([]);
  });

  test("marks injected compaction invalid after a bad request provider response", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi);
    const branch = [codexCompactionBranchEntry("pi-codex-compaction:test")];
    const payload = { input: [{ role: "user", content: "pi-codex-compaction:test" }] };

    // Act
    await fakePi.emit(
      "before_provider_request",
      { type: "before_provider_request", payload },
      contextWithBranch(branch),
    );
    await fakePi.emit(
      "after_provider_response",
      { type: "after_provider_response", status: 400, headers: {} },
      contextWithBranch(branch),
    );

    // Assert
    expect(fakePi.appendedEntries).toEqual([
      {
        customType: "codex-compaction-invalidated",
        data: { sentinel: "pi-codex-compaction:test", compactionEntryId: "cmp-entry", status: 400 },
      },
    ]);
  });
});

function messageEntry(id: string, message: unknown) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message,
  };
}

function assistantText(text: string) {
  return {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    content: [{ type: "text", text }],
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 2,
  };
}

function contextWithBranch(branch: unknown[]) {
  return {
    model: { id: "gpt-5.4-mini", provider: "openai-codex", api: "openai-codex-responses" },
    sessionManager: { getBranch: () => branch },
  };
}

function codexCompactionBranchEntry(sentinel: string) {
  return {
    type: "compaction",
    id: "cmp-entry",
    parentId: "parent",
    timestamp: new Date(0).toISOString(),
    summary: `placeholder ${sentinel}`,
    firstKeptEntryId: "kept",
    tokensBefore: 100,
    details: {
      codexCompaction: {
        version: 1,
        sentinel,
        provider: "openai-codex",
        api: "openai-codex-responses",
        modelId: "gpt-5.4-mini",
        item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      },
    },
  };
}

function compactionSse(): string {
  return [
    'data: {"type":"response.output_item.done","item":{"type":"compaction","encrypted_content":"enc","id":"cmp_1"}}',
    "",
  ].join("\n");
}

function jwtWithAccountId(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

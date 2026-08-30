import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { hashAccountId } from "./binding";
import { type CodexCompactionRuntime, registerCodexCompactionExtension } from "./register";
import { CODEX_OPAQUE_SUMMARY_PLACEHOLDER } from "./types";

const CODEX_CONTEXT_WINDOW_TOKENS = 272_000;
const CODEX_AUTO_COMPACTION_THRESHOLD_TOKENS = 244_800;

describe("registerCodexCompactionExtension", () => {
  test("registers remote compaction, provider injection, and early turn-end compaction handlers", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());

    // Assert
    expect(fakePi.handlers.has("turn_end")).toBe(true);
    expect(fakePi.handlers.has("session_before_compact")).toBe(true);
    expect(fakePi.handlers.has("before_provider_request")).toBe(true);
    expect(fakePi.handlers.has("after_provider_response")).toBe(false);
  });

  test("returns a successful remote-only Codex compaction", async () => {
    // Arrange
    const fakePi = createFakePi();
    const remoteCompact = mock(async () => remoteResult());
    const portableCompactOnly = mock(async () => undefined);
    registerCodexCompactionExtension(fakePi.pi, {
      remoteCompact: remoteCompact as CodexCompactionRuntime["remoteCompact"],
      portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
    });

    // Act
    const results = await fakePi.emit("session_before_compact", compactEvent(), codexCtx());

    // Assert
    expect(remoteCompact).toHaveBeenCalledTimes(1);
    expect(portableCompactOnly).toHaveBeenCalledTimes(0);
    expect(results[0]).toMatchObject({ compaction: { summary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER } });
  });

  test("cancels regular Codex compaction and surfaces the final endpoint reason", async () => {
    // Arrange
    const fakePi = createFakePi();
    const remoteCompact = mock(async () => {
      throw new Error("HTTP 503 after 15 request attempts; retries exhausted");
    });
    const portableCompactOnly = mock(async () => remoteResult());
    registerCodexCompactionExtension(fakePi.pi, {
      remoteCompact: remoteCompact as CodexCompactionRuntime["remoteCompact"],
      portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
    });

    // Act
    const results = await fakePi.emit("session_before_compact", compactEvent(), { ...codexCtx(), hasUI: true });

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(remoteCompact).toHaveBeenCalledTimes(1);
    expect(portableCompactOnly).toHaveBeenCalledTimes(0);
    expect(fakePi.uiNotifications[0]?.message).toContain("HTTP 503 after 15 request attempts; retries exhausted");
  });

  test("cancels regular Codex compaction when credentials are unavailable", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = completeRuntime();
    registerCodexCompactionExtension(fakePi.pi, runtime);

    // Act
    const results = await fakePi.emit("session_before_compact", compactEvent(), {
      ...codexCtx(),
      modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: false, error: "no key" })) },
    });

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(runtime.remoteCompact).toHaveBeenCalledTimes(0);
    expect(runtime.portableCompactOnly).toHaveBeenCalledTimes(0);
  });

  test("uses portable compaction only for non-Codex legacy recovery", async () => {
    // Arrange
    const fakePi = createFakePi();
    const portableCompactOnly = mock(async () => ({
      summary: "recovered portable",
      firstKeptEntryId: "kept",
      tokensBefore: 10,
      details: { recovery: { attempted: true, truncated: false, recoveredMessages: 1 } },
    }));
    const remoteCompact = mock(async () => undefined);
    registerCodexCompactionExtension(fakePi.pi, {
      remoteCompact: remoteCompact as CodexCompactionRuntime["remoteCompact"],
      portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
    });
    const branchEntries = [
      messageEntry("old", { role: "user", content: "old context", timestamp: 1 }),
      messageEntry("kept", { role: "user", content: "kept", timestamp: 2 }),
      v1Compaction("cmp", "kept"),
    ];

    // Act
    const results = await fakePi.emit("session_before_compact", compactEvent({ branchEntries }), nonCodexCtx());

    // Assert
    expect(portableCompactOnly).toHaveBeenCalledTimes(1);
    expect(remoteCompact).toHaveBeenCalledTimes(0);
    expect(results[0]).toMatchObject({ compaction: { summary: "recovered portable" } });
  });

  test("uses remote-only compaction for Codex legacy recovery and cancels on failure", async () => {
    // Arrange
    const fakePi = createFakePi();
    const remoteCompact = mock(async (_options: Parameters<CodexCompactionRuntime["remoteCompact"]>[0]) => undefined);
    const runtime: CodexCompactionRuntime = {
      remoteCompact,
      portableCompactOnly: mock(async () => undefined) as CodexCompactionRuntime["portableCompactOnly"],
    };
    registerCodexCompactionExtension(fakePi.pi, runtime);
    const branchEntries = [
      messageEntry("old", { role: "user", content: "old context", timestamp: 1 }),
      messageEntry("kept", { role: "user", content: "kept", timestamp: 2 }),
      v1Compaction("cmp", "kept"),
    ];

    // Act
    const results = await fakePi.emit("session_before_compact", compactEvent({ branchEntries }), codexCtx());

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(remoteCompact).toHaveBeenCalledTimes(1);
    expect(runtime.portableCompactOnly).toHaveBeenCalledTimes(0);
    expect(remoteCompact.mock.calls[0]?.[0]).toMatchObject({
      recovery: { attempted: true, truncated: false, recoveredMessages: 1 },
    });
  });

  test("cancels truncated legacy recovery before either compaction path", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = completeRuntime();
    registerCodexCompactionExtension(fakePi.pi, runtime);
    const branchEntries: unknown[] = Array.from({ length: 40 }, (_, index) =>
      messageEntry(`u${index}`, {
        role: "user",
        content: `context block ${index} ${"x".repeat(200)}`,
        timestamp: index,
      }),
    );
    branchEntries.push(messageEntry("kept", { role: "user", content: "kept", timestamp: 100 }));
    branchEntries.push(v1Compaction("cmp", "kept"));

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries,
        preparation: {
          ...basePrep(),
          messagesToSummarize: [{ role: "user", content: "y".repeat(400), timestamp: 101 }],
          settings: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 20 },
        },
      }),
      { ...codexCtx(), model: { ...codexModel(), contextWindow: 8_500 } },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(runtime.remoteCompact).toHaveBeenCalledTimes(0);
    expect(runtime.portableCompactOnly).toHaveBeenCalledTimes(0);
  });

  test("injects the latest compatible opaque artifact before a provider request", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());
    const branch = [v2BranchEntry()];
    const payload: { input: Record<string, unknown>[] } = {
      input: [
        { role: "user", content: `wrapped ${CODEX_OPAQUE_SUMMARY_PLACEHOLDER}` },
        { role: "user", content: "tail" },
      ],
    };

    // Act
    const results = await fakePi.emit(
      "before_provider_request",
      { type: "before_provider_request", payload },
      {
        model: codexModel(),
        sessionManager: { getBranch: () => branch, getSessionId: () => "sess" },
        modelRegistry: {
          getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: jwtWithAccountId("acct_123") })),
        },
      },
    );

    // Assert
    expect(results).toHaveLength(1);
    expect(payload.input).toEqual([
      { role: "user", content: "prior" },
      { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      { role: "user", content: "tail" },
    ]);
  });

  test("triggers early Codex auto-compaction at the native 90% context threshold", async () => {
    // Arrange
    const fakePi = createFakePi();
    const compact = mock(() => undefined);
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());

    // Act
    await fakePi.emit(
      "turn_end",
      {},
      {
        ...codexCtx(),
        getContextUsage: () => ({ tokens: CODEX_AUTO_COMPACTION_THRESHOLD_TOKENS }),
        compact,
      },
    );

    // Assert
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({ onComplete: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  test("guards duplicate early auto-compaction while the first trigger is in flight", async () => {
    // Arrange
    const fakePi = createFakePi();
    let callbacks: { onComplete: () => void; onError: (error: Error) => void } | undefined;
    const compact = mock((options) => {
      callbacks = options;
    });
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());
    const ctx = {
      ...codexCtx(),
      getContextUsage: () => ({ tokens: CODEX_AUTO_COMPACTION_THRESHOLD_TOKENS + 1 }),
      compact,
    };

    // Act
    await fakePi.emit("turn_end", {}, ctx);
    await fakePi.emit("turn_end", {}, ctx);
    callbacks?.onComplete();
    await fakePi.emit("turn_end", {}, ctx);

    // Assert
    expect(compact).toHaveBeenCalledTimes(2);
  });

  test("does not early-compact below threshold or on a non-Codex model", async () => {
    // Arrange
    const fakePi = createFakePi();
    const compact = mock(() => undefined);
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());

    // Act
    await fakePi.emit(
      "turn_end",
      {},
      {
        ...codexCtx(),
        getContextUsage: () => ({ tokens: CODEX_AUTO_COMPACTION_THRESHOLD_TOKENS - 1 }),
        compact,
      },
    );
    await fakePi.emit(
      "turn_end",
      {},
      {
        ...nonCodexCtx(),
        getContextUsage: () => ({ tokens: CODEX_AUTO_COMPACTION_THRESHOLD_TOKENS + 1 }),
        compact,
      },
    );

    // Assert
    expect(compact).toHaveBeenCalledTimes(0);
  });
});

function completeRuntime(): CodexCompactionRuntime {
  return {
    remoteCompact: mock(async () => undefined) as CodexCompactionRuntime["remoteCompact"],
    portableCompactOnly: mock(async () => undefined) as CodexCompactionRuntime["portableCompactOnly"],
  };
}

function compactEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "session_before_compact",
    preparation: basePrep(),
    branchEntries: [],
    customInstructions: undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function basePrep() {
  return {
    firstKeptEntryId: "kept",
    messagesToSummarize: [{ role: "user", content: "remember alpha", timestamp: 1 }],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 100,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1000 },
  };
}

function codexCtx() {
  return {
    model: codexModel(),
    hasUI: false,
    modelRegistry: {
      getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: jwtWithAccountId("acct_123") })),
    },
    getSystemPrompt: () => "system",
    sessionManager: { getBranch: () => [], getSessionId: () => "sess-1" },
  };
}

function nonCodexCtx() {
  return {
    model: { id: "claude", provider: "anthropic", api: "anthropic-messages", contextWindow: 200000 },
    hasUI: false,
    modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: "k" })) },
    getSystemPrompt: () => "system",
    sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
  };
}

function codexModel() {
  return {
    id: "gpt-5.6-sol",
    provider: "openai-codex",
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    headers: {},
    reasoning: true,
    thinkingLevelMap: { minimal: "low" },
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CODEX_CONTEXT_WINDOW_TOKENS,
    maxTokens: 32000,
    name: "sol",
  };
}

function remoteResult() {
  return {
    summary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER,
    firstKeptEntryId: "kept",
    tokensBefore: 100,
    details: {
      codexCompaction: {
        version: 2,
        binding: {
          provider: "openai-codex",
          api: "openai-codex-responses",
          modelId: "gpt-5.6-sol",
          endpoint: "https://chatgpt.com/backend-api/codex/responses",
          accountHash: hashAccountId("acct_123"),
        },
        userPrefix: [],
        artifact: [{ type: "compaction", encrypted_content: "enc", id: "cmp_1" }],
        firstKeptEntryId: "kept",
        tokensBefore: 100,
      },
    },
  };
}

function v1Compaction(id: string, firstKeptEntryId: string) {
  return {
    type: "compaction",
    id,
    parentId: firstKeptEntryId,
    timestamp: new Date(10).toISOString(),
    summary:
      "This history segment was compacted with Codex native opaque compaction.\nOpaque compaction sentinel: [pi-codex-compaction:test]",
    firstKeptEntryId,
    tokensBefore: 100,
    details: {
      codexCompaction: {
        version: 1,
        sentinel: "pi-codex-compaction:test",
        provider: "openai-codex",
        api: "openai-codex-responses",
        modelId: "gpt-5.6-sol",
        item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      },
    },
  };
}

function v2BranchEntry() {
  return {
    type: "compaction",
    id: "cmp-entry",
    parentId: "parent",
    timestamp: new Date(0).toISOString(),
    summary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER,
    firstKeptEntryId: "kept",
    tokensBefore: 100,
    details: {
      codexCompaction: {
        version: 2,
        binding: {
          provider: "openai-codex",
          api: "openai-codex-responses",
          modelId: "gpt-5.6-sol",
          endpoint: "https://chatgpt.com/backend-api/codex/responses",
          accountHash: hashAccountId("acct_123"),
        },
        userPrefix: [{ role: "user", content: "prior" }],
        artifact: [{ type: "compaction", encrypted_content: "enc", id: "cmp_1" }],
        firstKeptEntryId: "kept",
        tokensBefore: 100,
      },
    },
  };
}

function messageEntry(id: string, message: unknown) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message,
  };
}

function jwtWithAccountId(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

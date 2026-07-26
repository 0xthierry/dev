import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { hashAccountId } from "./binding";
import { type CodexCompactionRuntime, registerCodexCompactionExtension } from "./register";

describe("registerCodexCompactionExtension", () => {
  test("does not register after_provider_response", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());

    // Assert
    expect(fakePi.handlers.has("after_provider_response")).toBe(false);
    expect(fakePi.handlers.has("before_provider_request")).toBe(true);
    expect(fakePi.handlers.has("session_before_compact")).toBe(true);
  });

  test("dual success returns meaningful summary with v2 details", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async (options) => {
      expect(options.customInstructions).toBe("keep decisions");
      return {
        summary: "meaningful portable summary",
        firstKeptEntryId: "kept",
        tokensBefore: 100,
        usage: usage(10, 2),
        details: {
          readFiles: ["a.ts"],
          modifiedFiles: [],
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
    });
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: mock(async () => undefined) as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({ customInstructions: "keep decisions" }),
      codexCtx(),
    );

    // Assert
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      compaction: {
        summary: "meaningful portable summary",
        details: { codexCompaction: { version: 2 } },
      },
    });
    expect(JSON.stringify(results[0])).not.toContain("pi-codex-compaction:");
  });

  test("remote summary-only path returns portable details without artifact", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async () => ({
      summary: "summary only",
      firstKeptEntryId: "kept",
      tokensBefore: 10,
      details: { readFiles: [], modifiedFiles: ["z.ts"] },
    }));
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: mock(async () => undefined) as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit("session_before_compact", compactEvent(), codexCtx());

    // Assert
    expect(results[0]).toMatchObject({
      compaction: {
        summary: "summary only",
        details: { modifiedFiles: ["z.ts"] },
      },
    });
  });

  test("recovery on non-Codex uses portableCompactOnly", async () => {
    // Arrange
    const fakePi = createFakePi();
    const portableCompactOnly = mock(async () => ({
      summary: "recovered portable",
      firstKeptEntryId: "kept",
      tokensBefore: 10,
      details: { recovery: { attempted: true, truncated: false, recoveredMessages: 2 } },
    }));
    const dualCompact = mock(async () => undefined);
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: [
          messageEntry("u0", { role: "user", content: "old", timestamp: 1 }),
          messageEntry("kept", { role: "user", content: "kept", timestamp: 2 }),
          v1Compaction("cmp", "kept"),
        ],
        preparation: {
          ...basePrep(),
          previousSummary: "placeholder",
        },
      }),
      {
        model: {
          id: "claude",
          provider: "anthropic",
          api: "anthropic-messages",
          contextWindow: 200000,
        },
        hasUI: true,
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: "k" })) },
        getSystemPrompt: () => "system",
        sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
      },
    );

    // Assert
    expect(portableCompactOnly).toHaveBeenCalledTimes(1);
    expect(dualCompact).toHaveBeenCalledTimes(0);
    expect(results[0]).toMatchObject({ compaction: { summary: "recovered portable" } });
  });

  test("truncated recovery cancels on Codex without calling dualCompact", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async () => ({
      summary: "should-not-run",
      firstKeptEntryId: "kept",
      tokensBefore: 1,
    }));
    const portableCompactOnly = mock(async () => ({
      summary: "should-not-run",
      firstKeptEntryId: "kept",
      tokensBefore: 1,
    }));
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );
    const many: unknown[] = Array.from({ length: 40 }, (_, index) =>
      messageEntry(`u${index}`, {
        role: "user",
        content: `context block ${index} ${"x".repeat(200)}`,
        timestamp: index,
      }),
    );
    many.push(messageEntry("kept", { role: "user", content: "kept", timestamp: 100 }));
    many.push(v1Compaction("cmp", "kept"));

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: many,
        preparation: {
          ...basePrep(),
          messagesToSummarize: [{ role: "user", content: "y".repeat(400), timestamp: 101 }],
          settings: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 20 },
        },
      }),
      {
        ...codexCtx(),
        hasUI: true,
        model: { ...codexModel(), contextWindow: 8_500 },
      },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(dualCompact).toHaveBeenCalledTimes(0);
    expect(portableCompactOnly).toHaveBeenCalledTimes(0);
    expect(fakePi.uiNotifications.some((n) => n.type === "warning")).toBe(true);
  });

  test("truncated recovery cancels on non-Codex without calling portableCompactOnly", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async () => undefined);
    const portableCompactOnly = mock(async () => ({
      summary: "should-not-run",
      firstKeptEntryId: "kept",
      tokensBefore: 1,
    }));
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );
    const many: unknown[] = Array.from({ length: 40 }, (_, index) =>
      messageEntry(`u${index}`, {
        role: "user",
        content: `context block ${index} ${"x".repeat(200)}`,
        timestamp: index,
      }),
    );
    many.push(messageEntry("kept", { role: "user", content: "kept", timestamp: 100 }));
    many.push(v1Compaction("cmp", "kept"));

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: many,
        preparation: {
          ...basePrep(),
          messagesToSummarize: [{ role: "user", content: "y".repeat(400), timestamp: 101 }],
          settings: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 20 },
        },
      }),
      {
        model: {
          id: "claude",
          provider: "anthropic",
          api: "anthropic-messages",
          contextWindow: 8_500,
        },
        hasUI: true,
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: "k" })) },
        getSystemPrompt: () => "system",
        sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
      },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(dualCompact).toHaveBeenCalledTimes(0);
    expect(portableCompactOnly).toHaveBeenCalledTimes(0);
  });

  test("recovery cancels when model is missing", async () => {
    // Arrange
    const fakePi = createFakePi({ ctx: { hasUI: true } });
    const dualCompact = mock(async () => undefined);
    const portableCompactOnly = mock(async () => undefined);
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: [
          messageEntry("kept", { role: "user", content: "kept", timestamp: 1 }),
          v1Compaction("cmp", "kept"),
        ],
      }),
      {
        model: undefined,
        hasUI: true,
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: "k" })) },
        getSystemPrompt: () => "system",
        sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
      },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(dualCompact).toHaveBeenCalledTimes(0);
    expect(portableCompactOnly).toHaveBeenCalledTimes(0);
    expect(fakePi.uiNotifications.some((n) => n.type === "warning")).toBe(true);
  });

  test("recovery cancels on missing auth", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async () => undefined);
    const portableCompactOnly = mock(async () => undefined);
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: [
          messageEntry("kept", { role: "user", content: "kept", timestamp: 1 }),
          v1Compaction("cmp", "kept"),
        ],
      }),
      {
        ...codexCtx(),
        hasUI: true,
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: false, error: "no key" })) },
      },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(dualCompact).toHaveBeenCalledTimes(0);
  });

  test("recovery cancels when summary path fails", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async () => undefined);
    const portableCompactOnly = mock(async () => undefined);
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: [
          messageEntry("kept", { role: "user", content: "kept", timestamp: 1 }),
          v1Compaction("cmp", "kept"),
        ],
      }),
      { ...codexCtx(), hasUI: true },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(dualCompact).toHaveBeenCalledTimes(1);
  });

  test("recovery cancels on abort without warning", async () => {
    // Arrange
    const fakePi = createFakePi();
    const controller = new AbortController();
    controller.abort();
    const dualCompact = mock(async () => undefined);
    const portableCompactOnly = mock(async () => undefined);
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        signal: controller.signal,
        branchEntries: [
          messageEntry("kept", { role: "user", content: "kept", timestamp: 1 }),
          v1Compaction("cmp", "kept"),
        ],
      }),
      { ...codexCtx(), hasUI: true },
    );

    // Assert
    expect(results[0]).toEqual({ cancel: true });
    expect(fakePi.uiNotifications).toEqual([]);
  });

  test("latest ordinary boundary skips non-recovery non-codex path", async () => {
    // Arrange
    const fakePi = createFakePi();
    const dualCompact = mock(async () => undefined);
    const portableCompactOnly = mock(async () => undefined);
    registerCodexCompactionExtension(
      fakePi.pi,
      completeRuntime({
        dualCompact: dualCompact as CodexCompactionRuntime["dualCompact"],
        portableCompactOnly: portableCompactOnly as CodexCompactionRuntime["portableCompactOnly"],
      }),
    );

    // Act
    const results = await fakePi.emit(
      "session_before_compact",
      compactEvent({
        branchEntries: [
          {
            type: "compaction",
            id: "ord",
            parentId: null,
            timestamp: new Date(0).toISOString(),
            summary: "ordinary pi summary",
            firstKeptEntryId: "kept",
            tokensBefore: 1,
            details: { readFiles: [], modifiedFiles: [] },
          },
        ],
      }),
      {
        model: { id: "claude", provider: "anthropic", api: "anthropic-messages", contextWindow: 100000 },
        modelRegistry: { getApiKeyAndHeaders: mock(async () => ({ ok: true, apiKey: "k" })) },
        getSystemPrompt: () => "system",
        sessionManager: { getBranch: () => [], getSessionId: () => "sess" },
      },
    );

    // Assert
    expect(results).toEqual([]);
    expect(dualCompact).toHaveBeenCalledTimes(0);
    expect(portableCompactOnly).toHaveBeenCalledTimes(0);
  });

  test("before_provider_request injects latest compatible v2 artifact", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());
    const summary = "portable summary text";
    const branch = [v2BranchEntry(summary)];
    const payload = {
      input: [
        { role: "user", content: `wrap ${summary} wrap` },
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
    expect(payload.input[0]).toEqual({ role: "user", content: "prior" });
    expect(payload.input[1] as unknown).toEqual({
      type: "compaction",
      encrypted_content: "enc",
      id: "cmp_1",
    });
  });

  test("before_provider_request ignores older Codex under newer ordinary compaction", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerCodexCompactionExtension(fakePi.pi, completeRuntime());
    const branch = [
      v2BranchEntry("old summary"),
      {
        type: "compaction",
        id: "ordinary",
        parentId: "cmp-entry",
        timestamp: new Date(2).toISOString(),
        summary: "ordinary pi summary",
        firstKeptEntryId: "kept2",
        tokensBefore: 50,
        details: { readFiles: [], modifiedFiles: [] },
      },
    ];
    const payload = { input: [{ role: "user", content: "ordinary pi summary" }] };

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
    expect(results).toEqual([]);
    expect(payload.input[0]).toEqual({ role: "user", content: "ordinary pi summary" });
  });
});

function completeRuntime(runtime?: CodexCompactionRuntime): CodexCompactionRuntime {
  if (runtime) return runtime;
  return {
    dualCompact: mock(async () => undefined) as CodexCompactionRuntime["dualCompact"],
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
    contextWindow: 200000,
    maxTokens: 32000,
    name: "sol",
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

function v2BranchEntry(summary: string) {
  return {
    type: "compaction",
    id: "cmp-entry",
    parentId: "parent",
    timestamp: new Date(0).toISOString(),
    summary,
    firstKeptEntryId: "kept",
    tokensBefore: 100,
    details: {
      readFiles: ["a.ts"],
      modifiedFiles: [],
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

function usage(input: number, output: number) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

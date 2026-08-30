import { describe, expect, mock, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import type { CompactionPreparation } from "./recovery";
import {
  buildNextRemotePrefix,
  buildRemoteCompactionInput,
  buildRemoteCompactionResult,
  type RemoteCompactRuntime,
  remoteCompact,
} from "./remote-compaction";
import { CODEX_OPAQUE_SUMMARY_PLACEHOLDER, type CodexModel } from "./types";

const model = {
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
} as CodexModel;

describe("buildNextRemotePrefix / buildRemoteCompactionInput", () => {
  test("chains only the latest compatible v2 user prefix and artifact", () => {
    // Arrange
    const branch = [v2Entry("cmp", "enc-current")];

    // Act
    const prefix = buildNextRemotePrefix({
      preparation: basePreparation(),
      model,
      accountId: "acct_123",
      branchEntries: branch,
    });

    // Assert
    expect(prefix).toEqual([
      { role: "user", content: "prior" },
      { type: "compaction", encrypted_content: "enc-current", id: "cmp_1" },
    ]);
  });

  test("does not send the opaque placeholder when a v2 binding is incompatible", () => {
    // Arrange
    const branch = [v2Entry("cmp", "enc-current")];
    const preparation = basePreparation({ previousSummary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER });

    // Act
    const prefix = buildNextRemotePrefix({
      preparation,
      model,
      accountId: "different-account",
      branchEntries: branch,
    });

    // Assert
    expect(prefix).toEqual([{ role: "user", content: "prior" }]);
    expect(JSON.stringify(prefix)).not.toContain(CODEX_OPAQUE_SUMMARY_PLACEHOLDER);
  });

  test("retains a semantic summary from an older v2 record during migration", () => {
    // Arrange
    const branch = [v2Entry("cmp", "enc-current")];
    const preparation = basePreparation({ previousSummary: "real portable summary" });

    // Act
    const prefix = buildNextRemotePrefix({
      preparation,
      model,
      accountId: "different-account",
      branchEntries: branch,
    });

    // Assert
    expect(prefix).toEqual([
      { role: "user", content: "prior" },
      { role: "user", content: "Previous conversation summary:\nreal portable summary" },
    ]);
  });

  test("recovery with a compatible v1 artifact uses the original span without recovered duplicates", () => {
    // Arrange
    const original = basePreparation({
      messagesToSummarize: [{ role: "user", content: "current-only", timestamp: 2 }],
    });
    const recovered = basePreparation({
      messagesToSummarize: [
        { role: "user", content: "recovered-raw", timestamp: 1 },
        { role: "user", content: "current-only", timestamp: 2 },
      ],
    });

    // Act
    const input = buildRemoteCompactionInput({
      preparation: recovered,
      originalPreparation: original,
      model,
      accountId: "acct_123",
      branchEntries: [v1Entry()],
      recovery: { attempted: true, truncated: false, recoveredMessages: 1 },
    });

    // Assert
    expect(input).toEqual([
      { type: "compaction", encrypted_content: "v1-enc", id: "cmp_v1" },
      { role: "user", content: "current-only" },
    ]);
  });
});

describe("buildRemoteCompactionResult", () => {
  test("persists the opaque artifact, remote usage, placeholder, and preparation file metadata", () => {
    // Arrange
    const remoteResult = {
      ok: true as const,
      item: { type: "compaction" as const, encrypted_content: "enc-new", id: "cmp_new" },
      responseId: "resp_1",
      usage: usage(7, 2),
    };
    const preparation = basePreparation({
      messagesToSummarize: [{ role: "user", content: "remember alpha", timestamp: 1 }],
      fileOps: {
        read: new Set(["read.ts", "modified.ts"]),
        written: new Set(["created.ts"]),
        edited: new Set(["modified.ts"]),
      },
    });

    // Act
    const result = buildRemoteCompactionResult({
      remoteResult,
      preparation,
      model,
      accountId: "acct_123",
      branchEntries: [],
    });

    // Assert
    expect(result).toMatchObject({
      summary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER,
      firstKeptEntryId: "kept",
      tokensBefore: 100,
      usage: remoteResult.usage,
      details: {
        readFiles: ["read.ts"],
        modifiedFiles: ["created.ts", "modified.ts"],
        codexCompaction: {
          version: 2,
          artifact: [remoteResult.item],
          remoteUsage: remoteResult.usage,
          responseId: "resp_1",
        },
      },
    });
    expect(JSON.stringify(result.details)).not.toContain("acct_123");
  });
});

describe("remoteCompact", () => {
  test("uses only the remote endpoint client and returns its opaque result", async () => {
    // Arrange
    const fetchFn = mock(async () => ({
      ok: true as const,
      item: { type: "compaction" as const, encrypted_content: "enc", id: "cmp_1" },
      usage: usage(4, 1),
    }));
    const runtime: RemoteCompactRuntime = { fetchCodexCompaction: fetchFn as never };

    // Act
    const result = await remoteCompact({
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "remember alpha", timestamp: 1 }],
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123") },
      thinkingLevel: "low",
      systemPrompt: "system",
      branchEntries: [],
      runtime,
    });

    // Assert
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result?.summary).toBe(CODEX_OPAQUE_SUMMARY_PLACEHOLDER);
    expect(result?.usage).toEqual(usage(4, 1));
  });

  test("throws the final endpoint reason without a fallback model call", async () => {
    // Arrange
    const fetchFn = mock(async () => ({
      ok: false as const,
      reason: "endpoint unavailable",
      retryClass: "transport" as const,
      requestAttempts: 15,
      streamAttempts: 3,
      exhausted: true,
    }));
    const runtime: RemoteCompactRuntime = { fetchCodexCompaction: fetchFn as never };

    // Act
    const result = remoteCompact({
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "remember alpha", timestamp: 1 }],
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123") },
      thinkingLevel: "low",
      systemPrompt: "system",
      branchEntries: [],
      runtime,
    });

    // Assert
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await expect(result).rejects.toThrow(
      "endpoint unavailable (15 request attempts across 3 stream attempts; retries exhausted)",
    );
  });

  test("carries prior compaction file metadata without portable compaction", async () => {
    // Arrange
    const fetchFn = mock(async () => ({
      ok: true as const,
      item: { type: "compaction" as const, encrypted_content: "enc", id: "cmp_1" },
    }));
    const branch = [
      {
        type: "compaction",
        id: "cmp0",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        summary: "old summary",
        firstKeptEntryId: "kept",
        tokensBefore: 1,
        details: { readFiles: ["one.ts"], modifiedFiles: ["edited.ts"] },
      } as SessionEntry,
    ];

    // Act
    const result = await remoteCompact({
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "next", timestamp: 1 }],
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123") },
      thinkingLevel: "low",
      systemPrompt: "system",
      branchEntries: branch,
      runtime: { fetchCodexCompaction: fetchFn as never },
    });

    // Assert
    expect(result?.details).toMatchObject({ readFiles: ["one.ts"], modifiedFiles: ["edited.ts"] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

function basePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
  return {
    firstKeptEntryId: "kept",
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 100,
    previousSummary: undefined,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    ...overrides,
  };
}

function v2Entry(id: string, encrypted: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER,
    firstKeptEntryId: "kept",
    tokensBefore: 10,
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
        artifact: [{ type: "compaction", encrypted_content: encrypted, id: "cmp_1" }],
        firstKeptEntryId: "kept",
        tokensBefore: 10,
      },
    },
  } as SessionEntry;
}

function v1Entry(): SessionEntry {
  return {
    type: "compaction",
    id: "cmp",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary:
      "This history segment was compacted with Codex native opaque compaction.\nOpaque compaction sentinel: [pi-codex-compaction:test]",
    firstKeptEntryId: "kept",
    tokensBefore: 1,
    details: {
      codexCompaction: {
        version: 1,
        sentinel: "pi-codex-compaction:test",
        provider: "openai-codex",
        api: "openai-codex-responses",
        modelId: "gpt-5.6-sol",
        item: { type: "compaction", encrypted_content: "v1-enc", id: "cmp_v1" },
      },
    },
  } as SessionEntry;
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

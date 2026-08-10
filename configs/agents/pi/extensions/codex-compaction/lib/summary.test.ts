import { describe, expect, mock, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import type { CompactionPreparation } from "./recovery";
import {
  buildNextRemotePrefix,
  buildRemoteCompactionInput,
  type DualCompactRuntime,
  dualCompact,
  mergeDualCompactionResult,
} from "./summary";
import type { CodexModel } from "./types";

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
  test("chains latest compatible v2 userPrefix + artifact", () => {
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

  test("broken chain uses semantic previous summary and never a stale older artifact", () => {
    // Arrange
    const branch: SessionEntry[] = [v2Entry("old", "stale-artifact"), ordinary("new", "ordinary portable summary")];
    const preparation = basePreparation({ previousSummary: "semantic previous" });

    // Act
    const prefix = buildNextRemotePrefix({
      preparation,
      model,
      accountId: "acct_123",
      branchEntries: branch,
    });

    // Assert
    expect(prefix).toEqual([{ role: "user", content: "Previous conversation summary:\nsemantic previous" }]);
    expect(JSON.stringify(prefix)).not.toContain("stale-artifact");
  });

  test("recovery + compatible v1 uses artifact + original span, not recovered duplicates", () => {
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
    const branch = [v1Entry()];

    // Act
    const input = buildRemoteCompactionInput({
      preparation: recovered,
      originalPreparation: original,
      model,
      accountId: "acct_123",
      branchEntries: branch,
      recovery: { attempted: true, truncated: false, recoveredMessages: 1 },
    });

    // Assert
    expect(input).toEqual([
      { type: "compaction", encrypted_content: "v1-enc", id: "cmp_v1" },
      { role: "user", content: "current-only" },
    ]);
    expect(JSON.stringify(input)).not.toContain("recovered-raw");
  });

  test("compatible v1 chains artifact only from latest compaction", () => {
    // Arrange
    const branch: SessionEntry[] = [v1Entry()];

    // Act
    const prefix = buildNextRemotePrefix({
      preparation: basePreparation(),
      model,
      accountId: "acct_123",
      branchEntries: branch,
    });

    // Assert
    expect(prefix).toEqual([{ type: "compaction", encrypted_content: "v1-enc", id: "cmp_v1" }]);
  });
});

describe("mergeDualCompactionResult", () => {
  test("summary ok + remote ok preserves meaningful summary, Pi file details, v2, combined usage", () => {
    // Arrange
    const summaryResult = {
      summary: "meaningful portable summary about alpha",
      firstKeptEntryId: "kept",
      tokensBefore: 100,
      usage: usage(10, 5, 1),
      details: { readFiles: ["a.ts"], modifiedFiles: ["b.ts"] },
    };
    const remoteResult = {
      ok: true as const,
      item: { type: "compaction" as const, encrypted_content: "enc-new", id: "cmp_1" },
      responseId: "resp_1",
      usage: usage(7, 2, 0.5),
    };

    // Act
    const result = mergeDualCompactionResult({
      summaryResult,
      remoteResult,
      preparation: basePreparation({
        messagesToSummarize: [
          { role: "user", content: "old", timestamp: 1 },
          { role: "user", content: "new", timestamp: 2 },
        ],
      }),
      model,
      accountId: "acct_123",
      branchEntries: [v2Entry("prev", "prev-enc")],
    });

    // Assert
    expect(result?.summary).toBe("meaningful portable summary about alpha");
    expect(result?.details).toMatchObject({
      readFiles: ["a.ts"],
      modifiedFiles: ["b.ts"],
      codexCompaction: {
        version: 2,
        artifact: [{ type: "compaction", encrypted_content: "enc-new", id: "cmp_1" }],
        responseId: "resp_1",
      },
    });
    expect(JSON.stringify(result?.details)).not.toContain("acct_123");
    expect(result?.usage).toEqual(usage(17, 7, 1.5));
  });

  test("remote failure yields summary-only and combines known remote usage", () => {
    // Arrange
    const summaryResult = {
      summary: "portable only",
      firstKeptEntryId: "kept",
      tokensBefore: 50,
      usage: usage(3, 1, 0.1),
      details: { readFiles: ["x.ts"], modifiedFiles: [] },
    };

    // Act
    const result = mergeDualCompactionResult({
      summaryResult,
      remoteResult: { ok: false, reason: "cardinality", usage: usage(9, 0, 0.4) },
      preparation: basePreparation(),
      model,
      accountId: "acct_123",
      branchEntries: [],
    });

    // Assert
    expect(result?.summary).toBe("portable only");
    expect((result?.details as { codexCompaction?: unknown }).codexCompaction).toBeUndefined();
    expect(result?.usage).toEqual(usage(12, 1, 0.5));
  });
});

describe("dualCompact", () => {
  test("passes custom instructions to compact and combines concurrent remote success", async () => {
    // Arrange
    const providerHeaders = { "x-keep": "value", "x-remove": null };
    const compactFn = mock(async (_prep, _model, _key, headers, customInstructions) => {
      expect(headers).toBe(providerHeaders);
      expect(customInstructions).toBe("focus on decisions");
      return {
        summary: "meaningful portable summary",
        firstKeptEntryId: "kept",
        tokensBefore: 100,
        usage: usage(10, 5, 1),
        details: { readFiles: ["a.ts"], modifiedFiles: ["b.ts"] },
      };
    });
    const fetchFn = mock(async () => ({
      ok: true as const,
      item: { type: "compaction" as const, encrypted_content: "enc", id: "cmp_1" },
      responseId: "resp_1",
      usage: usage(4, 1, 0.2),
    }));
    const runtime: DualCompactRuntime = {
      compact: compactFn as never,
      fetchCodexCompaction: fetchFn as never,
    };

    // Act
    const result = await dualCompact({
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "remember alpha", timestamp: 1 }],
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123"), headers: providerHeaders },
      customInstructions: "focus on decisions",
      thinkingLevel: "low",
      systemPrompt: "system",
      sessionId: "session-stable",
      branchEntries: [],
      runtime,
    });

    // Assert
    expect(compactFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith(expect.objectContaining({ headers: providerHeaders }));
    expect(result?.summary).toBe("meaningful portable summary");
    expect(result?.usage).toEqual(usage(14, 6, 1.2));
  });

  test("summary failure returns undefined and discards remote artifact", async () => {
    // Arrange
    const fetchFn = mock(async () => ({
      ok: true as const,
      item: { type: "compaction" as const, encrypted_content: "enc", id: "cmp_1" },
    }));
    const runtime: DualCompactRuntime = {
      compact: mock(async () => {
        throw new Error("summary failed");
      }) as never,
      fetchCodexCompaction: fetchFn as never,
    };

    // Act
    const result = await dualCompact({
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "x", timestamp: 1 }],
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123") },
      thinkingLevel: "low",
      systemPrompt: "system",
      branchEntries: [],
      runtime,
    });

    // Assert
    expect(result).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("cumulative file metadata survives second portable compaction output", async () => {
    // Arrange — fresh second preparation; second branch latest uses details returned from first compact
    const firstDetails = { readFiles: ["one.ts"], modifiedFiles: ["edited.ts"] };
    const compactFn = mock(async (prep: CompactionPreparation) => {
      const readFiles = [...prep.fileOps.read].sort();
      const modifiedFiles = [...prep.fileOps.edited].sort();
      return {
        summary: `summary-${readFiles.join(",")}`,
        firstKeptEntryId: "kept",
        tokensBefore: 1,
        details: {
          readFiles: [...new Set([...readFiles, "fresh.ts"])].sort(),
          modifiedFiles,
        },
      };
    });
    const runtime: DualCompactRuntime = {
      compact: compactFn as never,
      fetchCodexCompaction: mock(async () => ({ ok: false as const, reason: "skip" })) as never,
    };

    // Act — first hook with prior latest entry carrying initial files
    const firstResult = await dualCompact({
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "a", timestamp: 1 }],
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123") },
      thinkingLevel: "low",
      systemPrompt: "system",
      branchEntries: [
        {
          type: "compaction",
          id: "cmp0",
          parentId: null,
          timestamp: new Date(0).toISOString(),
          summary: "seed",
          firstKeptEntryId: "kept",
          tokensBefore: 1,
          details: firstDetails,
        } as SessionEntry,
      ],
      runtime,
    });

    const secondResult = await dualCompact({
      // Fresh preparation — only branch latest details carry forward
      preparation: basePreparation({
        messagesToSummarize: [{ role: "user", content: "b", timestamp: 2 }],
        fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      }),
      model,
      auth: { apiKey: jwtWithAccountId("acct_123") },
      thinkingLevel: "low",
      systemPrompt: "system",
      branchEntries: [
        {
          type: "compaction",
          id: "cmp0",
          parentId: null,
          timestamp: new Date(0).toISOString(),
          summary: "seed",
          firstKeptEntryId: "kept",
          tokensBefore: 1,
          details: firstDetails,
        } as SessionEntry,
        {
          type: "compaction",
          id: "cmp1",
          parentId: "cmp0",
          timestamp: new Date(1).toISOString(),
          summary: firstResult?.summary ?? "first",
          firstKeptEntryId: "kept",
          tokensBefore: 1,
          details: firstResult?.details,
        } as SessionEntry,
      ],
      runtime,
    });

    // Assert — first-call files survive second output
    expect(firstResult?.details).toMatchObject({
      readFiles: expect.arrayContaining(["one.ts", "fresh.ts"]),
      modifiedFiles: ["edited.ts"],
    });
    expect(secondResult?.details).toMatchObject({
      readFiles: expect.arrayContaining(["one.ts", "fresh.ts"]),
      modifiedFiles: ["edited.ts"],
    });
    expect(compactFn).toHaveBeenCalledTimes(2);
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
    summary: "real portable summary",
    firstKeptEntryId: "kept",
    tokensBefore: 10,
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

function ordinary(id: string, summary: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(1).toISOString(),
    summary,
    firstKeptEntryId: "kept",
    tokensBefore: 1,
    details: { readFiles: [], modifiedFiles: [] },
  } as SessionEntry;
}

function jwtWithAccountId(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function usage(input: number, output: number, totalCost: number) {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCost },
  };
}

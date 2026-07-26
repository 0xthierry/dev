import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { type CompactionPreparation, computeRecoveryBudget, recoverFromV1Placeholder } from "./recovery";

describe("recoverFromV1Placeholder", () => {
  test("clears previousSummary and prepends raw pre-boundary messages", () => {
    // Arrange — realistic order: kept-boundary messages exist; compaction is after firstKept
    const branch: SessionEntry[] = [
      messageEntry("u0", { role: "user", content: "ancient context", timestamp: 1 }),
      messageEntry("a0", assistant("noted")),
      messageEntry("u1", { role: "user", content: "before boundary", timestamp: 3 }),
      messageEntry("kept", { role: "user", content: "kept tail", timestamp: 4 }),
      v1Compaction("cmp", "kept"),
    ];
    const preparation = basePreparation({
      previousSummary: "pi-codex-compaction:legacy-sentinel should not be reused",
      messagesToSummarize: [{ role: "user", content: "new discarded", timestamp: 6 }],
      firstKeptEntryId: "new-kept",
    });

    // Act
    const recovered = recoverFromV1Placeholder(preparation, branch, 200_000);

    // Assert
    expect(recovered).toBeDefined();
    expect(recovered?.preparation.previousSummary).toBeUndefined();
    expect(recovered?.preparation.messagesToSummarize.map((message: AgentMessage) => message.role)).toContain("user");
    expect(
      recovered?.preparation.messagesToSummarize.some(
        (message: AgentMessage) => message.role === "user" && message.content === "before boundary",
      ),
    ).toBe(true);
    expect(
      recovered?.preparation.messagesToSummarize.some(
        (message: AgentMessage) => message.role === "user" && message.content === "new discarded",
      ),
    ).toBe(true);
    expect(recovered?.recovery.attempted).toBe(true);
    expect(recovered?.recovery.recoveredMessages).toBeGreaterThan(0);
  });

  test("never treats a parsed v2 as recovery even if summary mentions the sentinel", () => {
    // Arrange
    const branch: SessionEntry[] = [
      messageEntry("kept", { role: "user", content: "tail", timestamp: 1 }),
      {
        type: "compaction",
        id: "cmp",
        parentId: "kept",
        timestamp: new Date(2).toISOString(),
        summary: "healthy summary that mentions pi-codex-compaction: accidentally",
        firstKeptEntryId: "kept",
        tokensBefore: 1,
        details: {
          codexCompaction: {
            version: 2,
            binding: {
              provider: "openai-codex",
              api: "openai-codex-responses",
              modelId: "gpt-5.6-sol",
              endpoint: "https://chatgpt.com/backend-api/codex/responses",
              accountHash: "abcd",
            },
            userPrefix: [],
            artifact: [{ type: "compaction", encrypted_content: "enc" }],
            firstKeptEntryId: "kept",
            tokensBefore: 1,
          },
        },
      } as SessionEntry,
    ];

    // Act
    const recovered = recoverFromV1Placeholder(basePreparation(), branch, 200_000);

    // Assert
    expect(recovered).toBeUndefined();
  });

  test("near-window context yields zero allowance and truncated recovery", () => {
    // Arrange
    const many: SessionEntry[] = Array.from({ length: 40 }, (_, index) =>
      messageEntry(`u${index}`, {
        role: "user",
        content: `context block ${index} ${"x".repeat(200)}`,
        timestamp: index,
      }),
    );
    many.push(messageEntry("kept", { role: "user", content: "kept", timestamp: 100 }));
    many.push(v1Compaction("cmp", "kept"));
    const preparation = basePreparation({
      previousSummary: exactLegacySummary(),
      messagesToSummarize: [{ role: "user", content: "y".repeat(400), timestamp: 101 }],
      settings: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 20 },
    });

    // Act
    const budget = computeRecoveryBudget(preparation, 8_500);
    const recovered = recoverFromV1Placeholder(preparation, many, 8_500);

    // Assert
    expect(budget).toBe(0);
    expect(recovered?.recovery.attempted).toBe(true);
    expect(recovered?.recovery.truncated).toBe(true);
    expect(recovered?.recovery.recoveredMessages).toBe(0);
  });

  test("early-manual large contextWindow allows substantial recovery", () => {
    // Arrange
    const branch: SessionEntry[] = [
      messageEntry("u0", { role: "user", content: "alpha context", timestamp: 1 }),
      messageEntry("u1", { role: "user", content: "beta context", timestamp: 2 }),
      messageEntry("kept", { role: "user", content: "kept", timestamp: 3 }),
      v1Compaction("cmp", "kept"),
    ];

    // Act
    const recovered = recoverFromV1Placeholder(basePreparation(), branch, 200_000);

    // Assert
    expect(recovered?.recovery.truncated).toBe(false);
    expect(recovered?.recovery.recoveredMessages).toBeGreaterThan(0);
  });

  test("merges full recovered fileOps even when message selection is truncated", () => {
    // Arrange
    const branch: SessionEntry[] = [
      {
        type: "message",
        id: "a0",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        message: {
          role: "assistant",
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-5.6-sol",
          content: [{ type: "toolCall", id: "c1|fc1", name: "read", arguments: { path: "old-file.ts" } }],
          usage: zeroUsage(),
          stopReason: "toolUse",
          timestamp: 1,
        },
      } as SessionEntry,
      messageEntry("kept", { role: "user", content: "kept", timestamp: 2 }),
      v1Compaction("cmp", "kept"),
    ];
    const preparation = basePreparation({
      previousSummary: exactLegacySummary(),
      messagesToSummarize: [{ role: "user", content: "z".repeat(500), timestamp: 3 }],
      settings: { enabled: true, reserveTokens: 8_000, keepRecentTokens: 20 },
    });

    // Act
    const recovered = recoverFromV1Placeholder(preparation, branch, 8_500);

    // Assert — budget ~0 so no messages, but full fileOps still merge
    expect(recovered).toBeDefined();
    if (!recovered) throw new Error("expected recovery");
    expect([...recovered.preparation.fileOps.read]).toEqual(["old-file.ts"]);
    expect(recovered.recovery.recoveredMessages).toBe(0);
  });

  test("missing firstKept slices only before latest compaction, not whole branch", () => {
    // Arrange — realistic parent links; post-compaction current also in preparation
    const branch: SessionEntry[] = [
      {
        type: "message",
        id: "u-pre",
        parentId: null,
        timestamp: new Date(1).toISOString(),
        message: { role: "user", content: "pre-compaction only once", timestamp: 1 },
      } as SessionEntry,
      {
        type: "message",
        id: "a-pre",
        parentId: "u-pre",
        timestamp: new Date(2).toISOString(),
        message: assistant("noted"),
      } as SessionEntry,
      {
        ...v1Compaction("cmp", "missing-kept-id"),
        parentId: "a-pre",
      } as SessionEntry,
      {
        type: "message",
        id: "u-post",
        parentId: "cmp",
        timestamp: new Date(4).toISOString(),
        message: { role: "user", content: "post-compaction current", timestamp: 4 },
      } as SessionEntry,
    ];
    const preparation = basePreparation({
      messagesToSummarize: [{ role: "user", content: "post-compaction current", timestamp: 4 }],
    });

    // Act
    const recovered = recoverFromV1Placeholder(preparation, branch, 200_000);

    // Assert
    expect(recovered).toBeDefined();
    if (!recovered) throw new Error("expected recovery");
    const texts = recovered.preparation.messagesToSummarize
      .filter((message: AgentMessage) => message.role === "user")
      .map((message: AgentMessage) => {
        if (message.role !== "user") return "";
        return typeof message.content === "string" ? message.content : "";
      });
    expect(texts.filter((text) => text === "pre-compaction only once")).toHaveLength(1);
    expect(texts.filter((text) => text === "post-compaction current")).toHaveLength(1);
    expect(texts).toEqual(["pre-compaction only once", "post-compaction current"]);
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

function exactLegacySummary(): string {
  return "This history segment was compacted with Codex native opaque compaction.\nOpaque compaction sentinel: [pi-codex-compaction:test]";
}

function v1Compaction(id: string, firstKeptEntryId: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: firstKeptEntryId,
    timestamp: new Date(10).toISOString(),
    summary: exactLegacySummary(),
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
  } as SessionEntry;
}

function messageEntry(id: string, message: unknown): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message,
  } as SessionEntry;
}

function assistant(text: string) {
  return {
    role: "assistant",
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    content: [{ type: "text", text }],
    usage: zeroUsage(),
    stopReason: "stop",
    timestamp: 2,
  };
}

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

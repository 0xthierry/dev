import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { mergeLatestCompactionFileOps } from "./file-ops";
import type { CompactionPreparation } from "./recovery";

describe("mergeLatestCompactionFileOps", () => {
  test("merges latest compaction file lists with modified winning over read", () => {
    // Arrange
    const preparation = basePreparation({
      fileOps: {
        read: new Set(["a.ts", "shared.ts"]),
        written: new Set(),
        edited: new Set(),
      },
    });
    const branch: SessionEntry[] = [
      {
        type: "compaction",
        id: "cmp",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        summary: "s",
        firstKeptEntryId: "kept",
        tokensBefore: 1,
        details: {
          readFiles: ["shared.ts", "b.ts"],
          modifiedFiles: ["shared.ts", "c.ts"],
        },
      } as SessionEntry,
    ];

    // Act
    const merged = mergeLatestCompactionFileOps(preparation, branch);

    // Assert
    expect([...merged.fileOps.read].sort()).toEqual(["a.ts", "b.ts"]);
    expect([...merged.fileOps.edited].sort()).toEqual(["c.ts", "shared.ts"]);
  });
});

function basePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
  return {
    firstKeptEntryId: "kept",
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 1,
    previousSummary: undefined,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1000 },
    ...overrides,
  };
}

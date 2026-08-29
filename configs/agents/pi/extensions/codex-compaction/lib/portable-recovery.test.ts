import { describe, expect, mock, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { portableCompactOnly } from "./portable-recovery";
import type { CompactionPreparation } from "./recovery";

describe("portableCompactOnly", () => {
  test("runs one portable model call only for migration and preserves recovery metadata", async () => {
    // Arrange
    const compactFn = mock(async (preparation: CompactionPreparation) => ({
      summary: "portable recovery",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: {
        readFiles: [...preparation.fileOps.read].sort(),
        modifiedFiles: [...preparation.fileOps.edited].sort(),
      },
    }));
    const branchEntries = [compactionEntry()] as SessionEntry[];

    // Act
    const result = await portableCompactOnly({
      preparation: basePreparation(),
      model: { id: "migration-model" } as never,
      auth: { apiKey: "key" },
      thinkingLevel: "off",
      recovery: { attempted: true, truncated: false, recoveredMessages: 1 },
      branchEntries,
      compactFn: compactFn as never,
    });

    // Assert
    expect(compactFn).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      summary: "portable recovery",
      details: {
        readFiles: ["old-read.ts"],
        modifiedFiles: ["old-edited.ts"],
        recovery: { attempted: true, truncated: false, recoveredMessages: 1 },
      },
    });
  });

  test("returns undefined when the migration model call fails", async () => {
    // Arrange
    const compactFn = mock(async () => {
      throw new Error("failed");
    });

    // Act
    const result = await portableCompactOnly({
      preparation: basePreparation(),
      model: { id: "migration-model" } as never,
      auth: { apiKey: "key" },
      thinkingLevel: "off",
      compactFn: compactFn as never,
    });

    // Assert
    expect(compactFn).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });
});

function basePreparation(): CompactionPreparation {
  return {
    firstKeptEntryId: "kept",
    messagesToSummarize: [],
    turnPrefixMessages: [],
    isSplitTurn: false,
    tokensBefore: 100,
    previousSummary: undefined,
    fileOps: { read: new Set(), written: new Set(), edited: new Set() },
    settings: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1000 },
  };
}

function compactionEntry() {
  return {
    type: "compaction",
    id: "cmp",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary: "prior",
    firstKeptEntryId: "kept",
    tokensBefore: 10,
    details: { readFiles: ["old-read.ts"], modifiedFiles: ["old-edited.ts"] },
  };
}

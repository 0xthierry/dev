import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import {
  isArtifactUnusable,
  isExactLegacyPlaceholderSummary,
  isSeamRepairDisabled,
  latestCompaction,
  parseCodexCompactionRecord,
} from "./state";
import { CODEX_COMPACTION_CUSTOM_INVALIDATION, SEAM_STRIKE_THRESHOLD } from "./types";

describe("latestCompaction", () => {
  test("only the latest compaction entry supplies remote state", () => {
    // Arrange
    const entries: SessionEntry[] = [v2Entry("old", "opaque-old"), ordinaryEntry("new", "portable summary")];

    // Act
    const latest = latestCompaction(entries);

    // Assert
    expect(latest.kind).toBe("ordinary");
    if (latest.kind === "ordinary") {
      expect(latest.entry.id).toBe("new");
    }
  });

  test("parses v2 with invalid artifact as v2 with empty artifact for prefix-only", () => {
    // Arrange
    const record = parseCodexCompactionRecord({
      version: 2,
      binding: {
        provider: "openai-codex",
        api: "openai-codex-responses",
        modelId: "gpt-5.6-sol",
        endpoint: "https://chatgpt.com/backend-api/codex/responses",
        accountHash: "abcd",
      },
      userPrefix: [
        { role: "user", content: "keep" },
        { role: "system", content: "bad" },
      ],
      artifact: [{ type: "compaction", encrypted_content: "" }],
      firstKeptEntryId: "kept",
      tokensBefore: 1,
    });

    // Act / Assert
    expect(record?.version).toBe(2);
    if (record?.version === 2) {
      expect(record.artifact).toEqual([]);
      expect(record.userPrefix).toEqual([{ role: "user", content: "keep" }]);
    }
  });
});

describe("legacy detection", () => {
  test("exact two-line legacy template matches", () => {
    // Arrange
    const exact =
      "This history segment was compacted with Codex native opaque compaction.\nOpaque compaction sentinel: [pi-codex-compaction:x]";

    // Act / Assert
    expect(isExactLegacyPlaceholderSummary(exact)).toBe(true);
    expect(isExactLegacyPlaceholderSummary(`  ${exact}  `)).toBe(true);
  });

  test("quoted/wrapped template and bare sentinel mentions do not match", () => {
    // Arrange
    const exact =
      "This history segment was compacted with Codex native opaque compaction.\nOpaque compaction sentinel: [pi-codex-compaction:x]";
    const quoted = `"${exact}"`;
    const wrapped = `<legacy>\n${exact}\n</legacy>`;
    const mention = "notes about pi-codex-compaction: in a real summary";
    const emptyId =
      "This history segment was compacted with Codex native opaque compaction.\nOpaque compaction sentinel: [pi-codex-compaction:]";

    // Act / Assert
    expect(isExactLegacyPlaceholderSummary(quoted)).toBe(false);
    expect(isExactLegacyPlaceholderSummary(wrapped)).toBe(false);
    expect(isExactLegacyPlaceholderSummary(mention)).toBe(false);
    expect(isExactLegacyPlaceholderSummary(emptyId)).toBe(false);
  });
});

describe("invalidation", () => {
  test("disables artifact after deterministic compaction rejection", () => {
    // Arrange
    const entries: SessionEntry[] = [
      v2Entry("cmp", "enc"),
      assistantError("invalid_request_error: unknown item type compaction rejected encrypted_content"),
    ];

    // Act / Assert
    expect(isArtifactUnusable(entries)).toBe(true);
  });

  test("restores recognition of custom codex-compaction-invalidated after v1 boundary", () => {
    // Arrange
    const entries: SessionEntry[] = [
      v1Entry("cmp-entry", "pi-codex-compaction:test"),
      {
        type: "custom",
        id: "inv",
        parentId: "cmp-entry",
        timestamp: new Date(2).toISOString(),
        customType: CODEX_COMPACTION_CUSTOM_INVALIDATION,
        data: { sentinel: "pi-codex-compaction:test", compactionEntryId: "cmp-entry", status: 400 },
      } as SessionEntry,
    ];

    // Act / Assert
    expect(isArtifactUnusable(entries)).toBe(true);
  });

  test("disables artifact injection once seam strike threshold is reached", () => {
    // Arrange
    const strikes = Array.from({ length: SEAM_STRIKE_THRESHOLD }, (_, index) =>
      assistantError(
        `Codex error: invalid_request_error No tool call found for function call output with call_id call_${index}`,
      ),
    );
    const below = [v2Entry("cmp", "enc"), strikes[0]];
    const at = [v2Entry("cmp", "enc"), ...strikes];

    // Act / Assert
    expect(isSeamRepairDisabled(below)).toBe(false);
    expect(isArtifactUnusable(below)).toBe(false);
    expect(isSeamRepairDisabled(at)).toBe(true);
    expect(isArtifactUnusable(at)).toBe(true);
  });
});

function ordinaryEntry(id: string, summary: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary,
    firstKeptEntryId: "kept",
    tokensBefore: 10,
    details: { readFiles: [], modifiedFiles: [] },
  } as SessionEntry;
}

function v1Entry(id: string, sentinel: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary: `placeholder ${sentinel}`,
    firstKeptEntryId: "kept",
    tokensBefore: 10,
    details: {
      codexCompaction: {
        version: 1,
        sentinel,
        provider: "openai-codex",
        api: "openai-codex-responses",
        modelId: "gpt-5.6-sol",
        item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
      },
    },
  } as SessionEntry;
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

function assistantError(errorMessage: string): SessionEntry {
  return {
    type: "message",
    id: `err-${Math.random()}`,
    parentId: "cmp",
    timestamp: new Date(1).toISOString(),
    message: {
      role: "assistant",
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      content: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "error",
      timestamp: 1,
      errorMessage,
    },
  } as SessionEntry;
}

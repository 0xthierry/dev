import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hasCompactableHistory } from "./early-compaction";

const timestamp = "2026-01-01T00:00:00.000Z";

function user(id: string, parentId: string | null, content: string): SessionEntry {
  return { type: "message", id, parentId, timestamp, message: { role: "user", content, timestamp: 0 } };
}

const toolCall: AgentMessage = {
  role: "assistant",
  api: "openai-responses",
  provider: "cliproxyapi",
  model: "gpt-6-astra",
  content: [{ type: "toolCall", id: "read-1", name: "read", arguments: { path: "probe.txt" } }],
  stopReason: "toolUse",
  timestamp: 0,
  usage: {
    input: 270_211,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 270_231,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

function toolEntries(parentId: string, resultText = "small result"): SessionEntry[] {
  return [
    { type: "message", id: "call", parentId, timestamp, message: toolCall },
    {
      type: "message",
      id: "result",
      parentId: "call",
      timestamp,
      message: {
        role: "toolResult",
        toolCallId: "read-1",
        toolName: "read",
        content: [{ type: "text", text: resultText }],
        isError: false,
        timestamp: 0,
      },
    },
  ];
}

describe("hasCompactableHistory", () => {
  test("uses visible history rather than large provider usage to decide whether there is a cut", () => {
    // Arrange
    const small = [user("u", null, "Read probe.txt"), ...toolEntries("u")];
    const large = [user("u", null, "Read probe.txt"), ...toolEntries("u", "large result ".repeat(1000))];

    // Act
    const results = [hasCompactableHistory(small, 1000), hasCompactableHistory(large, 1000)];

    // Assert
    expect(results).toEqual([false, true]);
  });

  test("does not treat a large system prompt as compactable conversation", () => {
    // Arrange
    const branch: SessionEntry[] = [
      {
        type: "message",
        id: "system",
        parentId: null,
        timestamp,
        message: { role: "system", content: "large fixed prompt ".repeat(10000), timestamp: 0 },
      },
      user("user", "system", "Read probe.txt"),
      ...toolEntries("user"),
    ];

    // Act
    const result = hasCompactableHistory(branch, 1000);

    // Assert
    expect(result).toBe(false);
  });

  test("honors the caller's retention budget instead of assuming the default", () => {
    // Arrange
    const branch = [user("old", null, "old context ".repeat(100)), user("recent", "old", "continue")];

    // Act
    const results = [hasCompactableHistory(branch, 20_000), hasCompactableHistory(branch, 1)];

    // Assert
    expect(results).toEqual([false, true]);
  });

  test("ignores history replaced by the latest compaction and resumes eligibility when new history grows", () => {
    // Arrange
    const branch: SessionEntry[] = [
      user("old", null, "discarded ".repeat(10000)),
      user("kept", "old", "continue"),
      {
        type: "compaction",
        id: "cmp",
        parentId: "kept",
        timestamp,
        summary: "opaque checkpoint",
        firstKeptEntryId: "kept",
        tokensBefore: 270_211,
      },
      ...toolEntries("cmp"),
    ];
    const grown = [...branch, user("new", "result", "new work ".repeat(1000)), user("next", "new", "continue")];

    // Act
    const results = [hasCompactableHistory(branch, 1000), hasCompactableHistory(grown, 1000)];

    // Assert
    expect(results).toEqual([false, true]);
  });

  test("applies context-edit omissions and replacements instead of counting raw transcript history", () => {
    // Arrange
    const original = [
      user("start", null, "begin task"),
      user("old", "start", "old context ".repeat(1000)),
      user("recent", "old", "continue"),
    ];
    const omitted: SessionEntry[] = [
      ...original,
      { type: "context_edit", id: "edit", parentId: "recent", timestamp, targetId: "old", replacement: null },
    ];
    const replaced: SessionEntry[] = [
      ...original,
      {
        type: "context_edit",
        id: "edit",
        parentId: "recent",
        timestamp,
        targetId: "old",
        replacement: { content: "short" },
      },
    ];

    // Act
    const results = [
      hasCompactableHistory(original, 1000),
      hasCompactableHistory(omitted, 1000),
      hasCompactableHistory(replaced, 1000),
    ];

    // Assert
    expect(results).toEqual([true, false, false]);
  });

  test("does not count metadata or an immediately completed compaction as new history", () => {
    // Arrange
    const branch: SessionEntry[] = [
      user("old", null, "old ".repeat(1000)),
      user("kept", "old", "continue"),
      {
        type: "compaction",
        id: "cmp",
        parentId: "kept",
        timestamp,
        summary: "checkpoint",
        firstKeptEntryId: "kept",
        tokensBefore: 270_211,
      },
    ];
    const withMetadata: SessionEntry[] = [
      ...branch,
      {
        type: "custom",
        id: "meta",
        parentId: "cmp",
        timestamp,
        customType: "bookkeeping",
        data: "not context ".repeat(1000),
      },
    ];

    // Act
    const results = [
      hasCompactableHistory(branch, 1),
      hasCompactableHistory(withMetadata, 1000),
      hasCompactableHistory([], 1),
    ];

    // Assert
    expect(results).toEqual([false, false, false]);
  });
});

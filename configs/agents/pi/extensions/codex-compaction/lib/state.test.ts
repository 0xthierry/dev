import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isInvalidated } from "./state";

const sentinel = "pi-codex-compaction:test";

describe("isInvalidated", () => {
  test("treats a later Codex tool-call protocol error as compaction invalidation", () => {
    // Arrange
    const entries: SessionEntry[] = [compactionEntry(), codexProtocolErrorEntry()];

    // Act
    const invalidated = isInvalidated(entries, sentinel);

    // Assert
    expect(invalidated).toBe(true);
  });

  test("ignores protocol errors that happened before the compaction", () => {
    // Arrange
    const entries: SessionEntry[] = [codexProtocolErrorEntry(), compactionEntry()];

    // Act
    const invalidated = isInvalidated(entries, sentinel);

    // Assert
    expect(invalidated).toBe(false);
  });
});

function compactionEntry(): SessionEntry {
  return {
    type: "compaction",
    id: "cmp-entry",
    parentId: "parent",
    timestamp: new Date(0).toISOString(),
    summary: `placeholder ${sentinel}`,
    firstKeptEntryId: "kept",
    tokensBefore: 123,
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

function codexProtocolErrorEntry(): SessionEntry {
  return {
    type: "message",
    id: "assistant-error",
    parentId: "user",
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
      errorMessage:
        'Codex error: {"type":"error","error":{"type":"invalid_request_error","message":"No tool call found for function call output with call_id call_1.","param":"input"},"status":400}',
    },
  } as SessionEntry;
}

import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import { repairOrphanCodexToolOutputs } from "./payload";
import { SEAM_STRIKE_THRESHOLD } from "./types";

describe("repairOrphanCodexToolOutputs", () => {
  test("does not repair when artifact injection did not occur (afterIndex default whole payload still requires no strike lock)", () => {
    // Arrange — call with afterIndex at end means nothing after boundary
    const payload: { input: Record<string, unknown>[] } = {
      input: [{ type: "function_call_output", call_id: "call_orphan", output: "late" }],
    };

    // Act
    const repaired = repairOrphanCodexToolOutputs(payload, [toolResultEntry()], 0);

    // Assert — boundary at 0, orphan at 0 is not after boundary
    expect(repaired).toBe(false);
    expect(payload.input).toHaveLength(1);
  });

  test("recovers real assistant toolCall arguments after the inserted boundary", () => {
    // Arrange
    const payload: { input: Record<string, unknown>[] } = {
      input: [
        { type: "compaction", encrypted_content: "enc" },
        { type: "function_call_output", call_id: "call_1", output: "ok" },
      ],
    };
    const branch: SessionEntry[] = [
      v2Boundary(),
      {
        type: "message",
        id: "assistant",
        parentId: "cmp",
        timestamp: new Date(0).toISOString(),
        message: {
          role: "assistant",
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-5.6-sol",
          content: [{ type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } }],
          usage: zeroUsage(),
          stopReason: "toolUse",
          timestamp: 1,
        },
      } as SessionEntry,
      toolResultEntry(),
    ];

    // Act
    const repaired = repairOrphanCodexToolOutputs(payload, branch, 0);

    // Assert
    expect(repaired).toBe(true);
    expect(payload.input[1]).toEqual({
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "read",
      arguments: JSON.stringify({ path: "a.ts" }),
    });
  });

  test("drops unknown orphan output rather than fabricating an unnamed call", () => {
    // Arrange
    const payload: { input: Record<string, unknown>[] } = {
      input: [
        { type: "compaction", encrypted_content: "enc" },
        { type: "function_call_output", call_id: "call_unknown", output: "ghost" },
      ],
    };

    // Act
    const repaired = repairOrphanCodexToolOutputs(payload, [v2Boundary()], 0);

    // Assert
    expect(repaired).toBe(true);
    expect(payload.input).toEqual([{ type: "compaction", encrypted_content: "enc" }]);
  });

  test("skips repair after seam strike threshold", () => {
    // Arrange
    const strikes = Array.from({ length: SEAM_STRIKE_THRESHOLD }, (_, index) => seamError(index));
    const branch: SessionEntry[] = [v2Boundary(), ...strikes, toolResultEntry()];
    const payload: { input: Record<string, unknown>[] } = {
      input: [
        { type: "compaction", encrypted_content: "enc" },
        { type: "function_call_output", call_id: "call_orphan", output: "late" },
      ],
    };

    // Act
    const repaired = repairOrphanCodexToolOutputs(payload, branch, 0);

    // Assert
    expect(repaired).toBe(false);
  });
});

function toolResultEntry(): SessionEntry {
  return {
    type: "message",
    id: "tool-result",
    parentId: "cmp",
    timestamp: new Date(1).toISOString(),
    message: {
      role: "toolResult",
      toolCallId: "call_orphan|fc_orphan",
      toolName: "bash",
      content: [{ type: "text", text: "late" }],
      isError: false,
      timestamp: 1,
    },
  } as SessionEntry;
}

function v2Boundary(): SessionEntry {
  return {
    type: "compaction",
    id: "cmp",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    summary: "summary",
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
          accountHash: hashAccountId("acct"),
        },
        userPrefix: [],
        artifact: [{ type: "compaction", encrypted_content: "enc" }],
        firstKeptEntryId: "kept",
        tokensBefore: 1,
      },
    },
  } as SessionEntry;
}

function seamError(index: number): SessionEntry {
  return {
    type: "message",
    id: `seam-${index}`,
    parentId: "cmp",
    timestamp: new Date(index + 1).toISOString(),
    message: {
      role: "assistant",
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      content: [],
      usage: zeroUsage(),
      stopReason: "error",
      timestamp: index + 1,
      errorMessage: "invalid_request_error No tool call found for function call output",
    },
  } as SessionEntry;
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

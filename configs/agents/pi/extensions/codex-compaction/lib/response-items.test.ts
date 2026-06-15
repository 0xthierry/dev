import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { messagesToCodexResponseItems } from "./response-items";

describe("messagesToCodexResponseItems", () => {
  test("preserves signed reasoning and tool-call continuity", () => {
    // Arrange
    const reasoningItem = { type: "reasoning", id: "rs_1", encrypted_content: "enc" };
    const messages: AgentMessage[] = [
      { role: "user", content: "remember alpha", timestamp: 1 },
      {
        role: "assistant",
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.4-mini",
        content: [
          { type: "thinking", thinking: "", thinkingSignature: JSON.stringify(reasoningItem) },
          { type: "toolCall", id: "call_1|fc_1", name: "read", arguments: { path: "a.ts" } },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolCallId: "call_1|fc_1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: 3,
      },
    ];

    // Act
    const items = messagesToCodexResponseItems(messages);

    // Assert
    expect(items).toEqual([
      { role: "user", content: "remember alpha" },
      reasoningItem,
      {
        type: "function_call",
        id: "fc_1",
        call_id: "call_1",
        name: "read",
        arguments: JSON.stringify({ path: "a.ts" }),
      },
      { type: "function_call_output", call_id: "call_1", output: "file contents" },
    ]);
  });

  test("synthesizes an error output for an unmatched tool call", () => {
    // Arrange
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.4-mini",
        content: [
          { type: "toolCall", id: "call_missing|fc_missing", name: "write", arguments: { path: "src/index.ts" } },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "error",
        errorMessage: "WebSocket error",
        timestamp: 2,
      },
      { role: "user", content: "continue", timestamp: 3 },
    ];

    // Act
    const items = messagesToCodexResponseItems(messages);

    // Assert
    expect(items).toEqual([
      {
        type: "function_call",
        id: "fc_missing",
        call_id: "call_missing",
        name: "write",
        arguments: JSON.stringify({ path: "src/index.ts" }),
      },
      {
        type: "function_call_output",
        call_id: "call_missing",
        output:
          "Tool call did not complete because the assistant turn failed before Pi recorded tool output: WebSocket error",
      },
      { role: "user", content: "continue" },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildUserPrefix, literalUserToPrefixItem } from "./user-prefix";

describe("buildUserPrefix", () => {
  test("keeps only literal text user messages and emits chronological order", () => {
    // Arrange
    const discarded: AgentMessage[] = [
      { role: "user", content: "one", timestamp: 1 },
      {
        role: "assistant",
        api: "openai-codex-responses",
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "nope" }],
        usage: zeroUsage(),
        stopReason: "stop",
        timestamp: 2,
      },
      {
        role: "custom",
        customType: "note",
        content: "custom should be excluded",
        display: true,
        timestamp: 3,
      } as AgentMessage,
      { role: "user", content: [{ type: "text", text: "two" }], timestamp: 4 },
    ];

    // Act
    const prefix = buildUserPrefix({ discardedMessages: discarded, keepRecentTokens: 10_000 });

    // Assert
    expect(prefix).toEqual([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
    ]);
  });

  test("retains text from mixed text+image user messages and ignores images", () => {
    // Arrange
    const message: AgentMessage = {
      role: "user",
      content: [
        { type: "text", text: "see this" },
        { type: "image", mimeType: "image/png", data: "abc" },
        { type: "text", text: "and that" },
      ],
      timestamp: 1,
    };

    // Act
    const item = literalUserToPrefixItem(message);

    // Assert
    expect(item).toEqual({ role: "user", content: "see this\nand that" });
  });

  test("drops user messages that have only images", () => {
    // Arrange
    const message: AgentMessage = {
      role: "user",
      content: [{ type: "image", mimeType: "image/png", data: "abc" }],
      timestamp: 1,
    };

    // Act
    const item = literalUserToPrefixItem(message);

    // Assert
    expect(item).toBeUndefined();
  });

  test("zero keepRecentTokens returns empty prefix", () => {
    // Arrange
    const discarded: AgentMessage[] = [
      { role: "user", content: "one", timestamp: 1 },
      { role: "user", content: "two", timestamp: 2 },
    ];

    // Act
    const prefix = buildUserPrefix({ discardedMessages: discarded, keepRecentTokens: 0 });

    // Assert
    expect(prefix).toEqual([]);
  });

  test("omits an oversized newest item instead of forcing it through", () => {
    // Arrange
    const discarded: AgentMessage[] = [
      { role: "user", content: "small", timestamp: 1 },
      { role: "user", content: "x".repeat(400), timestamp: 2 }, // ~100 tokens
    ];

    // Act
    const prefix = buildUserPrefix({ discardedMessages: discarded, keepRecentTokens: 20 });

    // Assert — oversized newest omitted; no partial/truncated item
    expect(prefix).toEqual([]);
    expect(prefix.every((item) => typeof item.content === "string" && !item.content.includes("…"))).toBe(true);
  });

  test("combines previous prefix with new users then trims to newest budget", () => {
    // Arrange
    const previous = [
      { role: "user", content: "old-a" },
      { role: "user", content: "old-b" },
    ];
    const discarded: AgentMessage[] = [
      { role: "user", content: "new-1", timestamp: 1 },
      { role: "user", content: "new-2", timestamp: 2 },
    ];

    // Act
    const prefix = buildUserPrefix({
      previousUserPrefix: previous,
      discardedMessages: discarded,
      keepRecentTokens: 2, // enough for newest only ("new-2" ~= 1 token)
    });

    // Assert
    expect(prefix).toEqual([{ role: "user", content: "new-2" }]);
  });
});

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

import { describe, expect, test } from "bun:test";
import { getAssistantDeltaTokenCount, isAssistantMessage } from "./events";

describe("token speed event helpers", () => {
  test("recognizes assistant messages", () => {
    // Arrange
    const messages = [{ role: "assistant" }, { role: "user" }, undefined];

    // Act
    const results = messages.map((message) => isAssistantMessage(message));

    // Assert
    expect(results).toEqual([true, false, false]);
  });

  test("counts text and thinking deltas", () => {
    // Arrange
    const events = [
      { type: "text_delta", delta: "Hello" },
      { type: "thinking_delta", delta: "hmm" },
      { type: "text_delta", delta: "" },
      { type: "text_start" },
    ];

    // Act
    const results = events.map((event) => getAssistantDeltaTokenCount(event));

    // Assert
    expect(results).toEqual([1, 1, 0, 0]);
  });
});

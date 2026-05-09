import { describe, expect, test } from "bun:test";
import { applyPiChildJsonEvent, createPiChildEventState, textFromContentParts } from "./pi-events";

describe("applyPiChildJsonEvent", () => {
  test("captures final assistant output and metadata", () => {
    // Arrange
    const state = createPiChildEventState();
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Child result" }],
        model: "test-model",
        stopReason: "stop",
      },
    };

    // Act
    const parsed = applyPiChildJsonEvent(state, JSON.stringify(event));

    // Assert
    expect(parsed).toBe(true);
    expect(state).toEqual({ finalOutput: "Child result", model: "test-model", stopReason: "stop" });
  });

  test("ignores malformed and non-assistant events", () => {
    // Arrange
    const state = createPiChildEventState();

    // Act
    const malformed = applyPiChildJsonEvent(state, "not json");
    const user = applyPiChildJsonEvent(
      state,
      JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "Task" }] } }),
    );

    // Assert
    expect(malformed).toBe(false);
    expect(user).toBe(false);
    expect(state.finalOutput).toBe("");
  });
});

describe("textFromContentParts", () => {
  test("joins text parts", () => {
    // Arrange
    const content = [
      { type: "text", text: "first" },
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "second" },
    ];

    // Act
    const result = textFromContentParts(content);

    // Assert
    expect(result).toBe("first\nsecond");
  });
});

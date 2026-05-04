import { describe, expect, test } from "bun:test";
import { applyChildJsonEvent, createChildAgentEventState } from "./json-events";

describe("applyChildJsonEvent", () => {
  test("captures final assistant text and usage from message_end events", () => {
    // Arrange
    const state = createChildAgentEventState();
    const event = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Agent result" }],
        model: "test-model",
        stopReason: "stop",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 3,
          totalTokens: 20,
          cost: { total: 0.123 },
        },
      },
    };

    // Act
    const parsed = applyChildJsonEvent(state, JSON.stringify(event));

    // Assert
    expect(parsed).toBe(true);
    expect(state.finalOutput).toBe("Agent result");
    expect(state.model).toBe("test-model");
    expect(state.stopReason).toBe("stop");
    expect(state.usage).toEqual({
      input: 10,
      output: 5,
      cacheRead: 2,
      cacheWrite: 3,
      totalTokens: 20,
      cost: 0.123,
      turns: 1,
    });
  });

  test("ignores non-assistant events", () => {
    // Arrange
    const state = createChildAgentEventState();
    const event = { type: "message_end", message: { role: "user", content: [{ type: "text", text: "Task" }] } };

    // Act
    const parsed = applyChildJsonEvent(state, JSON.stringify(event));

    // Assert
    expect(parsed).toBe(false);
    expect(state.finalOutput).toBe("");
    expect(state.usage.turns).toBe(0);
  });

  test("ignores malformed JSON lines", () => {
    // Arrange
    const state = createChildAgentEventState();

    // Act
    const parsed = applyChildJsonEvent(state, "not json");

    // Assert
    expect(parsed).toBe(false);
    expect(state.finalOutput).toBe("");
  });
});

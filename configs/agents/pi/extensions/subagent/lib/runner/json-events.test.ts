import { describe, expect, test } from "bun:test";
import { applyChildJsonEvent, createChildAgentEventState } from "./json-events";

describe("applyChildJsonEvent", () => {
  test("captures the child Pi session id from the session header", () => {
    // Arrange
    const state = createChildAgentEventState();
    const event = { type: "session", id: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574" };

    // Act
    const parsed = applyChildJsonEvent(state, JSON.stringify(event));

    // Assert
    expect(parsed).toBe(true);
    expect(state.sessionId).toBe("019e1882-8bc8-767c-a1e6-d7c9ebd3a574");
  });

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
    expect(state.activity).toEqual([{ kind: "assistant", status: "completed", text: "Agent result" }]);
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

  test("captures assistant message updates while the child is streaming", () => {
    // Arrange
    const state = createChildAgentEventState();
    const event = {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Partial agent output" }],
      },
    };

    // Act
    const parsed = applyChildJsonEvent(state, JSON.stringify(event));

    // Assert
    expect(parsed).toBe(true);
    expect(state.finalOutput).toBe("");
    expect(state.currentAssistantText).toBe("Partial agent output");
    expect(state.activity).toEqual([{ kind: "assistant", status: "running", text: "Partial agent output" }]);
  });

  test("captures child tool execution activity", () => {
    // Arrange
    const state = createChildAgentEventState();
    const start = {
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "bash",
      args: { command: "rg auth configs" },
    };
    const end = {
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "bash",
      result: { content: [{ type: "text", text: "configs/auth.ts" }] },
      isError: false,
    };

    // Act
    const startParsed = applyChildJsonEvent(state, JSON.stringify(start));
    const endParsed = applyChildJsonEvent(state, JSON.stringify(end));

    // Assert
    expect(startParsed).toBe(true);
    expect(endParsed).toBe(true);
    expect(state.activity).toEqual([
      {
        kind: "tool",
        toolCallId: "tool-1",
        toolName: "bash",
        status: "succeeded",
        argsPreview: "$ rg auth configs",
        outputPreview: "configs/auth.ts",
      },
    ]);
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

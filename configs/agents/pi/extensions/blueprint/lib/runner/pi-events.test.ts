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
    expect(state).toMatchObject({
      finalOutput: "Child result",
      model: "test-model",
      stopReason: "stop",
      activity: [{ kind: "assistant", status: "completed", text: "Child result" }],
    });
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

  test("captures streaming assistant deltas and tool activity", () => {
    // Arrange
    const state = createPiChildEventState();

    // Act
    const assistantUpdate = applyPiChildJsonEvent(
      state,
      JSON.stringify({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "Looking at files" }] },
      }),
    );
    const toolStart = applyPiChildJsonEvent(
      state,
      JSON.stringify({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "bash",
        args: { command: "bun test" },
      }),
    );
    const toolEnd = applyPiChildJsonEvent(
      state,
      JSON.stringify({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "pass" }] },
      }),
    );

    // Assert
    expect([assistantUpdate, toolStart, toolEnd]).toEqual([true, true, true]);
    expect(state.activity).toEqual([
      { kind: "assistant", status: "running", text: "Looking at files" },
      {
        kind: "tool",
        toolCallId: "call-1",
        toolName: "bash",
        status: "succeeded",
        argsPreview: "$ bun test",
        outputPreview: "pass",
      },
    ]);
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

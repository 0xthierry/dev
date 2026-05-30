import { describe, expect, test } from "bun:test";
import { applyWorkflowChildJsonEvent, createWorkflowChildEventState } from "./json-events";

describe("workflow child JSON events", () => {
  test("captures assistant output and usage", () => {
    // Arrange
    const state = createWorkflowChildEventState();
    const line = JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Child result" }],
        model: "fake/model",
        usage: { input: 2, output: 3, cost: { total: 0.01 } },
      },
    });

    // Act
    const changed = applyWorkflowChildJsonEvent(state, line);

    // Assert
    expect(changed).toBe(true);
    expect(state.finalOutput).toBe("Child result");
    expect(state.model).toBe("fake/model");
    expect(state.usage.input).toBe(2);
    expect(state.usage.output).toBe(3);
  });

  test("captures tool activity and structured output", () => {
    // Arrange
    const state = createWorkflowChildEventState();
    const start = JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "structured_output",
      args: { ok: true },
    });
    const end = JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "structured_output",
      result: { content: [{ type: "text", text: "Structured output received." }], details: { ok: true } },
    });

    // Act
    applyWorkflowChildJsonEvent(state, start);
    applyWorkflowChildJsonEvent(state, end);

    // Assert
    expect(state.structuredOutputCalled).toBe(true);
    expect(state.structuredOutput).toEqual({ ok: true });
    expect(state.activity).toMatchObject([{ kind: "tool", status: "succeeded", toolName: "structured_output" }]);
  });
});

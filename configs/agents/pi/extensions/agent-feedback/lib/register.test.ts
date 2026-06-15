import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerAgentFeedback, registerAgentFeedbackExtension } from "./register";
import type { AgentFeedbackRuntime } from "./runtime";
import { AGENT_FEEDBACK_TOOL_NAME } from "./tool";

afterEach(() => {
  setSystemTime();
});

describe("registerAgentFeedbackExtension", () => {
  test("registers the agent feedback tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerAgentFeedbackExtension(fakePi.pi);

    // Assert
    expect(fakePi.tools.has(AGENT_FEEDBACK_TOOL_NAME)).toBe(true);
  });
});

describe("registerAgentFeedback", () => {
  test("wires the tool to the provided runtime", async () => {
    // Arrange
    setSystemTime(new Date(2026, 4, 11, 9, 7, 30));
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime: AgentFeedbackRuntime = {
      buildPath: mock(() => ({
        filePath: "/feedback/repo/agent_feedback.md",
        displayPath: "agent_feedback.md",
      })),
      appendEntry: mock(async () => undefined),
    };
    registerAgentFeedback(fakePi.pi, runtime);

    // Act
    await fakePi.runTool(AGENT_FEEDBACK_TOOL_NAME, {
      category: "tooling_friction",
      summary: "Tool failed twice.",
      impact: "Validation took longer.",
    });

    // Assert
    expect(runtime.appendEntry).toHaveBeenCalledWith({
      filePath: "/feedback/repo/agent_feedback.md",
      entry: expect.stringContaining("Summary: Tool failed twice."),
    });
  });
});

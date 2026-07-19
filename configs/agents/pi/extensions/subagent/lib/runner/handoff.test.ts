import { describe, expect, test } from "bun:test";
import { synthesizeCrashHandoff } from "./handoff";
import { createChildAgentEventState } from "./json-events";

describe("synthesizeCrashHandoff", () => {
  test("reconstructs a handoff from transcript state when the child died mid-run", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.usage.turns = 7;
    state.stopReason = "error";
    state.errorMessage = "context window exceeded";
    state.currentAssistantText = "Now verifying the repository index...";
    state.activity.push(
      { kind: "assistant", status: "completed", text: "Reading the schema first." },
      {
        kind: "tool",
        toolCallId: "t1",
        toolName: "bash",
        status: "succeeded",
        argsPreview: "$ make typecheck",
        outputPreview: "0 errors",
      },
      { kind: "tool", toolCallId: "t2", toolName: "read", status: "running", argsPreview: "read src/schema.ts" },
    );

    // Act
    const report = synthesizeCrashHandoff({
      agentName: "test-author",
      state,
      exitCode: 1,
      stderr: "boom\n",
      sessionFile: "/agent-sessions/--repo--/session.jsonl",
    });

    // Assert
    expect(report).toContain("# Synthesized handoff: test-author exited without a final report");
    expect(report).toContain("- Exit code: 1");
    expect(report).toContain("- Stop reason: error");
    expect(report).toContain("- Error: context window exceeded");
    expect(report).toContain("- Turns: 7");
    expect(report).toContain("- Child session (resumable): /agent-sessions/--repo--/session.jsonl");
    expect(report).toContain("Now verifying the repository index...");
    expect(report).toContain("- assistant [completed]: Reading the schema first.");
    expect(report).toContain("- bash [succeeded] $ make typecheck → 0 errors");
    expect(report).toContain("- read [running] read src/schema.ts");
    expect(report).toContain("## Stderr (tail)");
    expect(report).toContain("boom");
  });

  test("omits empty sections", () => {
    // Arrange
    const state = createChildAgentEventState();

    // Act
    const report = synthesizeCrashHandoff({ agentName: "implementer", state, exitCode: 0, stderr: "" });

    // Assert
    expect(report).toContain("# Synthesized handoff: implementer exited without a final report");
    expect(report).not.toContain("## Last assistant text");
    expect(report).not.toContain("## Recent activity");
    expect(report).not.toContain("## Stderr");
    expect(report).not.toContain("Child session (resumable)");
  });
});

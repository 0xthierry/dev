import { describe, expect, test } from "bun:test";
import { createWorkflowSnapshot, formatWorkflowSnapshot, recomputeWorkflowSnapshot } from "./render";

describe("workflow rendering", () => {
  test("renders compact workflow progress", () => {
    // Arrange
    let snapshot = createWorkflowSnapshot({ name: "demo", description: "desc", phases: [{ title: "Scan" }] });
    snapshot.agents.push({
      id: 1,
      label: "repo inventory",
      phase: "Scan",
      prompt: "Inspect",
      status: "succeeded",
      activity: [],
    });
    snapshot = recomputeWorkflowSnapshot(snapshot);

    // Act
    const text = formatWorkflowSnapshot(snapshot, { completed: true });

    // Assert
    expect(text).toContain("Workflow completed");
    expect(text).toContain("◆ Workflow: demo (1/1 done");
    expect(text).toContain("#1 ✓ repo inventory");
  });

  test("includes artifacts and activity in expanded view", () => {
    // Arrange
    let snapshot = createWorkflowSnapshot({ name: "demo", description: "desc" }, { runDir: "/tmp/run" });
    snapshot.agents.push({
      id: 1,
      label: "repo inventory",
      prompt: "Inspect",
      status: "succeeded",
      outputArtifactPath: "/tmp/run/agents/01/output.md",
      activity: [{ kind: "tool", toolCallId: "tool-1", toolName: "bash", status: "succeeded", argsPreview: "$ pwd" }],
    });
    snapshot = recomputeWorkflowSnapshot(snapshot);

    // Act
    const text = formatWorkflowSnapshot(snapshot, { expanded: true, completed: true });

    // Assert
    expect(text).toContain("run: /tmp/run");
    expect(text).toContain("✓ bash $ pwd");
    expect(text).toContain("output: /tmp/run/agents/01/output.md");
  });
});

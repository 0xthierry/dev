import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentFeedbackRuntime } from "./runtime";

let tempProject: string | undefined;

afterEach(async () => {
  if (tempProject) await rm(tempProject, { recursive: true, force: true });
  tempProject = undefined;
});

describe("createAgentFeedbackRuntime", () => {
  test("creates a runtime that builds cwd feedback paths and appends entries", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-agent-feedback-project-"));
    const runtime = createAgentFeedbackRuntime();
    const path = runtime.buildPath(tempProject);
    const entry = "## 2026-05-11 09:07 — environment_gap\n\nSummary: Missing tool.\n\n";

    // Act
    await runtime.appendEntry({ filePath: path.filePath, entry });
    const content = await readFile(path.filePath, "utf8");

    // Assert
    expect(path.filePath).toBe(join(tempProject, "agent_feedback.md"));
    expect(path.displayPath).toBe("agent_feedback.md");
    expect(content).toContain("Summary: Missing tool.");
  });
});

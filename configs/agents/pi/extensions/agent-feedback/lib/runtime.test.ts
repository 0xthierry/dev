import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentFeedbackRuntime } from "./runtime";

let tempHome: string | undefined;

afterEach(async () => {
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
  tempHome = undefined;
});

describe("createAgentFeedbackRuntime", () => {
  test("creates a runtime that builds project feedback paths and appends entries", async () => {
    // Arrange
    tempHome = await mkdtemp(join(tmpdir(), "pi-agent-feedback-home-"));
    const runtime = createAgentFeedbackRuntime(tempHome);
    const path = runtime.buildPath("/workspace/project");
    const entry = "## 2026-05-11 09:07 — environment_gap\n\nSummary: Missing tool.\n\n";

    // Act
    await runtime.appendEntry({ filePath: path.filePath, entry });
    const content = await readFile(path.filePath, "utf8");

    // Assert
    expect(path.displayPath).toBe("~/.pi/agent/feedback/workspace/project/agent_feedback.md");
    expect(path.projectKey).toBe("workspace/project");
    expect(content).toContain("Summary: Missing tool.");
  });
});

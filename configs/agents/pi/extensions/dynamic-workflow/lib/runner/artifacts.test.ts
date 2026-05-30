import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflowAgentArtifactPaths, createWorkflowRunArtifacts, encodeProjectCwd, safeName } from "./artifacts";

describe("workflow artifacts", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("creates run artifacts under the encoded project key", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-workflow-artifacts-"));

    // Act
    const artifacts = await createWorkflowRunArtifacts({
      cwd: "/home/me/repo",
      workflowName: "Demo Flow",
      agentDir: tempDir,
    });
    await artifacts.writeScript("return true");

    // Assert
    expect(artifacts.runDir).toContain(encodeProjectCwd("/home/me/repo"));
    expect(artifacts.runDir).toContain("demo-flow");
    expect(await readFile(join(artifacts.runDir, "workflow.js"), "utf8")).toBe("return true");
  });

  test("creates stable agent artifact paths", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-workflow-agent-artifacts-"));

    // Act
    const paths = await createWorkflowAgentArtifactPaths({ runDir: tempDir, index: 2, label: "Repo Inventory" });

    // Assert
    expect(paths.inputPath).toContain("02_repo-inventory");
    expect(paths.outputPath).toContain("output.md");
  });

  test("normalizes names", () => {
    // Arrange
    const value = "  Repo Inventory!  ";

    // Act
    const result = safeName(value);

    // Assert
    expect(result).toBe("repo-inventory");
  });
});

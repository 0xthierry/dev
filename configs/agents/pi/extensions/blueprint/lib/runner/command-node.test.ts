import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlueprintTemplateState } from "../template";
import { executeCommandNode } from "./command-node";

describe("executeCommandNode", () => {
  test("renders the command, executes it through the shell boundary, and records success", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-blueprint-command-node-"));
    const nodeDir = join(dir, "node");
    await mkdir(nodeDir);
    const runShellCommand = mock(async () => ({ stdout: "ok\n", stderr: "", exitCode: 0, timedOut: false }));

    try {
      // Act
      const result = await executeCommandNode({
        nodeId: "lint",
        node: { type: "command", run: "echo {{input.task}}" },
        attempt: 1,
        cwd: "/repo",
        nodeDir,
        templateState: templateState("hello"),
        runShellCommand,
      });

      // Assert
      expect(result).toMatchObject({
        nodeId: "lint",
        type: "command",
        status: "success",
        command: "echo hello",
        output: "ok",
        exitCode: 0,
      });
      expect(runShellCommand).toHaveBeenCalledWith("echo hello", {
        cwd: "/repo",
        signal: undefined,
        timeoutMs: undefined,
      });
      expect(await readFile(join(nodeDir, "command.txt"), "utf8")).toBe("echo hello");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("marks non-zero commands as failures", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-blueprint-command-node-"));
    const nodeDir = join(dir, "node");
    await mkdir(nodeDir);
    const runShellCommand = mock(async () => ({ stdout: "", stderr: "bad\n", exitCode: 1, timedOut: false }));

    try {
      // Act
      const result = await executeCommandNode({
        nodeId: "test",
        node: { type: "command", run: "false" },
        attempt: 1,
        cwd: "/repo",
        nodeDir,
        templateState: templateState("task"),
        runShellCommand,
      });

      // Assert
      expect(result.status).toBe("failure");
      expect(result.output).toBe("bad");
      expect(result.exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function templateState(task: string): BlueprintTemplateState {
  return {
    blueprint: {
      id: "user/flow",
      name: "flow",
      description: "Flow",
      scope: "user",
      filePath: "/blueprints/flow.jsonc",
      dir: "/blueprints",
      definition: { name: "flow", description: "Flow", start: "done", nodes: { done: { type: "stop" } } },
    },
    input: { task },
    contextFile: "/context.md",
    context: "context",
    nodes: {},
  };
}

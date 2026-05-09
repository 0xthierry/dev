import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BlueprintNodeResult, LoadedBlueprint } from "../types";
import { type BlueprintNodeExecutors, runBlueprint } from "./execute";

describe("runBlueprint", () => {
  test("runs command failure through a bounded pi fix loop", async () => {
    // Arrange
    const artifactRootDir = await mkdtemp(join(tmpdir(), "pi-blueprint-run-"));
    const commandCalls: string[] = [];
    const command = mock(async (options: Parameters<BlueprintNodeExecutors["command"]>[0]) => {
      commandCalls.push(options.nodeId);
      return nodeResult(options.nodeId, "command", commandCalls.length >= 2 ? "success" : "failure", options.attempt, {
        command: options.node.run,
        output: commandCalls.length >= 2 ? "lint ok" : "lint failed",
        exitCode: commandCalls.length >= 2 ? 0 : 1,
      });
    });
    const pi = mock(async (options: Parameters<BlueprintNodeExecutors["pi"]>[0]) =>
      nodeResult(options.nodeId, "pi", "success", options.attempt, { output: `fixed after ${options.nodeId}` }),
    );
    const executors = fakeExecutors(command, pi);
    const blueprint = loadedBlueprint({
      start: "lint",
      nodes: {
        lint: { type: "command", run: "lint", on: { success: "done", failure: "fix" } },
        fix: { type: "pi", prompt: "Fix {{nodes.lint.output}}", maxAttempts: 2, next: "lint" },
        done: { type: "final", message: "done" },
      },
    });

    try {
      // Act
      const result = await runBlueprint({ blueprint, task: "task", cwd: "/repo", artifactRootDir }, undefined, {
        executors,
      });

      // Assert
      expect(result.status).toBe("succeeded");
      expect(result.results.map((node) => `${node.nodeId}:${node.status}`)).toEqual([
        "lint:failure",
        "fix:success",
        "lint:success",
        "done:success",
      ]);
      expect(executors.pi).toHaveBeenCalledTimes(1);
    } finally {
      await rm(artifactRootDir, { recursive: true, force: true });
    }
  });

  test("fails when a loop exceeds node maxAttempts", async () => {
    // Arrange
    const artifactRootDir = await mkdtemp(join(tmpdir(), "pi-blueprint-run-"));
    const command = mock(async (options: Parameters<BlueprintNodeExecutors["command"]>[0]) =>
      nodeResult(options.nodeId, "command", "failure", options.attempt, { output: "still failing", exitCode: 1 }),
    );
    const pi = mock(async (options: Parameters<BlueprintNodeExecutors["pi"]>[0]) =>
      nodeResult(options.nodeId, "pi", "success", options.attempt, { output: "fixed" }),
    );
    const executors = fakeExecutors(command, pi);
    const blueprint = loadedBlueprint({
      start: "check",
      nodes: {
        check: { type: "command", run: "check", on: { failure: "fix" } },
        fix: { type: "pi", prompt: "Fix", maxAttempts: 1, next: "check" },
      },
    });

    try {
      // Act
      const result = await runBlueprint({ blueprint, task: "task", cwd: "/repo", artifactRootDir }, undefined, {
        executors,
      });

      // Assert
      expect(result.status).toBe("failed");
      expect(result.message).toBe("Node 'fix' exceeded maxAttempts (1).");
    } finally {
      await rm(artifactRootDir, { recursive: true, force: true });
    }
  });
});

function fakeExecutors(
  command: BlueprintNodeExecutors["command"],
  pi: BlueprintNodeExecutors["pi"],
): BlueprintNodeExecutors {
  return {
    hydrate: mock(async (_blueprint, _cwd, task) => `hydrated ${task}`),
    command,
    pi,
  };
}

function nodeResult(
  nodeId: string,
  type: BlueprintNodeResult["type"],
  status: BlueprintNodeResult["status"],
  attempt: number,
  overrides: Partial<BlueprintNodeResult> = {},
): BlueprintNodeResult {
  return {
    nodeId,
    type,
    attempt,
    status,
    output: `${nodeId} output`,
    startedAt: "start",
    finishedAt: "finish",
    ...overrides,
  };
}

function loadedBlueprint(definition: Pick<LoadedBlueprint["definition"], "start" | "nodes">): LoadedBlueprint {
  return {
    id: "user/test-flow",
    name: "test-flow",
    description: "Test flow",
    scope: "user",
    filePath: "/blueprints/test-flow.json",
    dir: "/blueprints",
    definition: { name: "test-flow", description: "Test flow", ...definition },
  };
}

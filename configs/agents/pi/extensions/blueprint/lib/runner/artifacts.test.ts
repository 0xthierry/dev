import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedBlueprint } from "../types";
import { buildRunId, createBlueprintRunArtifacts, defaultBlueprintRunRoot } from "./artifacts";

describe("createBlueprintRunArtifacts", () => {
  test("creates stable artifact paths and writes context/results", async () => {
    // Arrange
    const rootDir = await mkdtemp(join(tmpdir(), "pi-blueprint-artifacts-"));
    const blueprint = loadedBlueprint("implement");

    try {
      // Act
      const artifacts = await createBlueprintRunArtifacts(blueprint, "/repo", {
        rootDir,
        now: () => new Date("2026-01-02T03:04:05.006Z"),
      });
      await artifacts.writeContext("context");
      await artifacts.writeNodeResult({
        nodeId: "lint",
        type: "command",
        attempt: 1,
        status: "success",
        output: "ok",
        stdout: "stdout",
        stderr: "stderr",
        startedAt: "start",
        finishedAt: "finish",
      });

      // Assert
      expect(artifacts.runId).toBe("2026-01-02T03-04-05-006Z");
      expect(await readFile(artifacts.contextFile, "utf8")).toBe("context");
      expect(await readFile(join(artifacts.runDir, "nodes", "01-lint", "stdout.log"), "utf8")).toBe("stdout");
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("artifact path helpers", () => {
  test("builds run ids and default roots", () => {
    // Arrange
    const date = new Date("2026-05-09T10:11:12.013Z");

    // Act
    const runId = buildRunId(date);
    const root = defaultBlueprintRunRoot("/home/me/repo", "/home/me/.pi/agent");

    // Assert
    expect(runId).toBe("2026-05-09T10-11-12-013Z");
    expect(root).toBe("/home/me/.pi/agent/blueprint-runs/home-me-repo");
  });
});

function loadedBlueprint(name: string): LoadedBlueprint {
  return {
    id: `user/${name}`,
    name,
    description: `${name} description`,
    scope: "user",
    filePath: `/blueprints/${name}.json`,
    dir: "/blueprints",
    definition: { name, description: `${name} description`, start: "done", nodes: { done: { type: "final" } } },
  };
}

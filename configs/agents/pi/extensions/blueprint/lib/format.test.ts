import { describe, expect, test } from "bun:test";
import {
  formatBlueprintList,
  formatBlueprintProgress,
  formatBlueprintRunSummary,
  resolveBlueprintSelection,
} from "./format";
import type { BlueprintDiscoveryResult, BlueprintRunResult, LoadedBlueprint } from "./types";

describe("resolveBlueprintSelection", () => {
  test("selects exact scoped ids and reports ambiguous names", () => {
    // Arrange
    const discovery = discoveryResult([loadedBlueprint("user", "flow"), loadedBlueprint("project", "flow")]);

    // Act
    const exact = resolveBlueprintSelection(discovery, "project/flow");
    const ambiguous = resolveBlueprintSelection(discovery, "flow");

    // Assert
    expect(exact).toMatchObject({ ok: true, blueprint: { id: "project/flow" } });
    expect(ambiguous).toEqual({
      ok: false,
      message: "Ambiguous blueprint 'flow'. Use one of: user/flow, project/flow.",
    });
  });
});

describe("formatBlueprintList", () => {
  test("formats blueprints and discovery errors", () => {
    // Arrange
    const discovery = discoveryResult(
      [loadedBlueprint("user", "flow")],
      [{ filePath: "/bad.json", message: "Invalid JSON" }],
    );

    // Act
    const text = formatBlueprintList(discovery);

    // Assert
    expect(text).toContain("user/flow — flow description");
    expect(text).toContain("/bad.json: Invalid JSON");
  });
});

describe("blueprint run formatting", () => {
  test("formats progress and final summary", () => {
    // Arrange
    const result: BlueprintRunResult = {
      runId: "run-1",
      runDir: "/runs/run-1",
      contextFile: "/runs/run-1/context.md",
      blueprint: "user/flow",
      task: "task",
      status: "succeeded",
      message: "done",
      results: [
        {
          nodeId: "check",
          type: "command",
          attempt: 1,
          status: "success",
          output: "ok",
          startedAt: "start",
          finishedAt: "finish",
        },
      ],
    };

    // Act
    const progress = formatBlueprintProgress(result);
    const summary = formatBlueprintRunSummary(result);

    // Assert
    expect(progress.join("\n")).toContain("✓ check (command) success");
    expect(summary).toContain("Blueprint user/flow succeeded.");
    expect(summary).toContain("Nodes: 1/1 succeeded.");
  });
});

function discoveryResult(
  blueprints: LoadedBlueprint[],
  errors: BlueprintDiscoveryResult["errors"] = [],
): BlueprintDiscoveryResult {
  return { dirs: ["/blueprints"], blueprints, errors };
}

function loadedBlueprint(scope: LoadedBlueprint["scope"], name: string): LoadedBlueprint {
  return {
    id: `${scope}/${name}`,
    name,
    description: `${name} description`,
    scope,
    filePath: `/blueprints/${name}.json`,
    dir: "/blueprints",
    definition: { name, description: `${name} description`, start: "done", nodes: { done: { type: "final" } } },
  };
}

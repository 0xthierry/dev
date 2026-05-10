import { describe, expect, test } from "bun:test";
import {
  formatBlueprintList,
  formatBlueprintProgress,
  formatBlueprintRunSummary,
  formatBlueprintWorkflow,
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
      [{ filePath: "/bad.jsonc", message: "Invalid JSONC" }],
    );

    // Act
    const text = formatBlueprintList(discovery);

    // Assert
    expect(text).toContain("user/flow — flow description");
    expect(text).toContain("/bad.jsonc: Invalid JSONC");
  });
});

describe("blueprint run formatting", () => {
  test("formats workflow visualization", () => {
    // Arrange
    const blueprint = loadedBlueprint("project", "flow", {
      start: "context",
      nodes: {
        context: { type: "pi", prompt: "write context", tools: ["read", "write"], next: "implement" },
        implement: { type: "pi", prompt: "implement", next: "lint" },
        lint: { type: "command", run: "bun run lint", on: { success: "done", failure: "fix_lint" } },
        fix_lint: { type: "pi", prompt: "fix {{nodes.lint.output}}", maxAttempts: 2, next: "lint" },
        done: { type: "stop", message: "Workflow complete." },
      },
    });
    const progress = {
      runId: "run-1",
      runDir: "/runs/run-1",
      status: "running" as const,
      currentNodeId: "lint",
      message: "Running lint (command).",
      results: [nodeResult("context", "pi", "success"), nodeResult("implement", "pi", "success")],
    };

    // Act
    const lines = formatBlueprintWorkflow(progress, blueprint, "add auth");
    const text = lines.join("\n");

    // Assert
    expect(text).toContain("⏳ Blueprint project/flow — running");
    expect(text).toContain("Task: add auth");
    expect(text).toContain("2/5 done · lint running · 2 queued");
    expect(text).toContain("✓ context [pi] succeeded attempt 1 — tools read,write");
    expect(text).toContain("⏳ lint [command] running attempt 1 — bun run lint");
    expect(text).toContain("↳ success → done · failure → fix_lint");
    expect(text).toContain("○ fix_lint [pi] queued");
  });

  test("formats live pi node activity", () => {
    // Arrange
    const blueprint = loadedBlueprint("project", "flow", {
      start: "implement",
      nodes: {
        implement: { type: "pi", prompt: "implement", next: "done" },
        done: { type: "stop", message: "Workflow complete." },
      },
    });
    const progress = {
      runId: "run-1",
      runDir: "/runs/run-1",
      status: "running" as const,
      currentNodeId: "implement",
      message: "Running implement (pi).",
      results: [],
      activeNode: {
        nodeId: "implement",
        type: "pi" as const,
        attempt: 1,
        activity: [
          { kind: "assistant" as const, status: "running" as const, text: "I am planning the edit." },
          {
            kind: "tool" as const,
            toolCallId: "tool-1",
            toolName: "read",
            status: "succeeded" as const,
            argsPreview: "read src/index.ts",
            outputPreview: "file contents",
          },
        ],
      },
    };

    // Act
    const text = formatBlueprintWorkflow(progress, blueprint, "add auth").join("\n");

    // Assert
    expect(text).toContain("⏳ implement [pi] running attempt 1");
    expect(text).toContain("assistant: I am planning the edit.");
    expect(text).toContain("✓ read read src/index.ts → file contents");
  });

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

function loadedBlueprint(
  scope: LoadedBlueprint["scope"],
  name: string,
  definition: Partial<LoadedBlueprint["definition"]> = {},
): LoadedBlueprint {
  return {
    id: `${scope}/${name}`,
    name,
    description: `${name} description`,
    scope,
    filePath: `/blueprints/${name}.jsonc`,
    dir: "/blueprints",
    definition: {
      name,
      description: `${name} description`,
      start: "done",
      nodes: { done: { type: "stop" } },
      ...definition,
    },
  };
}

function nodeResult(
  nodeId: string,
  type: BlueprintRunResult["results"][number]["type"],
  status: BlueprintRunResult["results"][number]["status"],
): BlueprintRunResult["results"][number] {
  return {
    nodeId,
    type,
    attempt: 1,
    status,
    output: `${nodeId} output`,
    startedAt: "start",
    finishedAt: "finish",
  };
}

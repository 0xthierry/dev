import { describe, expect, test } from "bun:test";
import {
  BLUEPRINT_PROGRESS_MESSAGE_TYPE,
  blueprintProgressMessage,
  formatBlueprintProgressMessageLines,
} from "./progress-message";
import type { BlueprintRunProgress, LoadedBlueprint } from "./types";

describe("blueprintProgressMessage", () => {
  test("builds a visible custom message with compact content and detailed workflow data", () => {
    // Arrange
    const blueprint = loadedBlueprint();
    const progress = runningProgress();

    // Act
    const message = blueprintProgressMessage(blueprint, "add auth", progress);

    // Assert
    expect(message).toMatchObject({
      customType: BLUEPRINT_PROGRESS_MESSAGE_TYPE,
      content: "Blueprint project/flow running: Running lint (command).",
      display: true,
      details: { blueprint: { id: "project/flow" }, task: "add auth", progress: { currentNodeId: "lint" } },
    });
    expect(message.details.progress.results).not.toBe(progress.results);
  });
});

describe("formatBlueprintProgressMessageLines", () => {
  test("formats a collapsed transcript card with node statuses", () => {
    // Arrange
    const details = { blueprint: loadedBlueprint(), task: "add auth", progress: runningProgress() };

    // Act
    const lines = formatBlueprintProgressMessageLines(details);
    const text = lines.join("\n");

    // Assert
    expect(text).toContain("⏳ Blueprint project/flow — running");
    expect(text).toContain("2/4 done · lint running · 1 queued");
    expect(text).toContain("✓ context [pi] succeeded attempt 1");
    expect(text).toContain("⏳ lint [command] running attempt 1 — bun run lint");
    expect(text).toContain("Artifacts: /runs/run-1");
  });
});

function loadedBlueprint(): LoadedBlueprint {
  return {
    id: "project/flow",
    name: "flow",
    description: "Flow description",
    scope: "project",
    filePath: "/repo/.pi/blueprint/flow.jsonc",
    dir: "/repo/.pi/blueprint",
    definition: {
      name: "flow",
      description: "Flow description",
      start: "context",
      nodes: {
        context: { type: "pi", prompt: "context", next: "implement" },
        implement: { type: "pi", prompt: "implement", next: "lint" },
        lint: { type: "command", run: "bun run lint", next: "done" },
        done: { type: "stop", message: "done" },
      },
    },
  };
}

function runningProgress(): BlueprintRunProgress {
  return {
    runId: "run-1",
    runDir: "/runs/run-1",
    status: "running",
    currentNodeId: "lint",
    message: "Running lint (command).",
    results: [
      {
        nodeId: "context",
        type: "pi",
        attempt: 1,
        status: "success",
        output: "context done",
        startedAt: "start",
        finishedAt: "finish",
      },
      {
        nodeId: "implement",
        type: "pi",
        attempt: 1,
        status: "success",
        output: "implementation done",
        startedAt: "start",
        finishedAt: "finish",
      },
    ],
  };
}

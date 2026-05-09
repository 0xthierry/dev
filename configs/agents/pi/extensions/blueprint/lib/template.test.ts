import { describe, expect, test } from "bun:test";
import type { BlueprintTemplateState } from "./template";
import { renderBlueprintTemplate } from "./template";

describe("renderBlueprintTemplate", () => {
  test("renders input, context, blueprint, and node result fields", () => {
    // Arrange
    const state: BlueprintTemplateState = {
      blueprint: {
        id: "project/implement",
        name: "implement",
        description: "Implement",
        scope: "project",
        filePath: "/repo/.pi/blueprint/implement.json",
        dir: "/repo/.pi/blueprint",
        definition: { name: "implement", description: "Implement", start: "done", nodes: { done: { type: "final" } } },
      },
      input: { task: "add branch display" },
      contextFile: "/runs/context.md",
      context: "Hydrated context",
      nodes: {
        lint: {
          nodeId: "lint",
          type: "command",
          attempt: 1,
          status: "failure",
          command: "bun run lint",
          output: "lint failed",
          startedAt: "start",
          finishedAt: "finish",
        },
      },
    };

    // Act
    const text = renderBlueprintTemplate(
      "{{blueprint.id}} {{input.task}} {{context.file}} {{nodes.lint.command}} {{nodes.lint.output}}",
      state,
    );

    // Assert
    expect(text).toBe("project/implement add branch display /runs/context.md bun run lint lint failed");
  });

  test("renders missing fields as empty strings", () => {
    // Arrange
    const state = minimalState();

    // Act
    const text = renderBlueprintTemplate("before {{nodes.missing.output}} after", state);

    // Assert
    expect(text).toBe("before  after");
  });
});

function minimalState(): BlueprintTemplateState {
  return {
    blueprint: {
      id: "user/simple",
      name: "simple",
      description: "Simple",
      scope: "user",
      filePath: "/blueprints/simple.json",
      dir: "/blueprints",
      definition: { name: "simple", description: "Simple", start: "done", nodes: { done: { type: "final" } } },
    },
    input: { task: "task" },
    contextFile: "/context.md",
    context: "context",
    nodes: {},
  };
}

import { describe, expect, test } from "bun:test";
import { parseBlueprintCommandArgs, splitCommandArgs } from "./args";

describe("parseBlueprintCommandArgs", () => {
  test("lists blueprints when no arguments are provided", () => {
    // Arrange
    const args = "   ";

    // Act
    const result = parseBlueprintCommandArgs(args);

    // Assert
    expect(result).toEqual({ mode: "list" });
  });

  test("parses a selected blueprint and task", () => {
    // Arrange
    const args = "project/implement add branch display";

    // Act
    const result = parseBlueprintCommandArgs(args);

    // Assert
    expect(result).toEqual({ mode: "run", selection: "project/implement", task: "add branch display" });
  });

  test("requires a task when running a blueprint", () => {
    // Arrange
    const args = "implement";

    // Act
    const result = parseBlueprintCommandArgs(args);

    // Assert
    expect(result).toEqual({ mode: "error", message: "Usage: /blueprint <name|scope/name> <task>" });
  });
});

describe("splitCommandArgs", () => {
  test("preserves quoted arguments", () => {
    // Arrange
    const args = "'project/flow' \"task with spaces\" tail";

    // Act
    const tokens = splitCommandArgs(args);

    // Assert
    expect(tokens).toEqual(["project/flow", "task with spaces", "tail"]);
  });
});

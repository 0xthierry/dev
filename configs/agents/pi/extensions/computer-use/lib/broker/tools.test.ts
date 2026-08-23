import { describe, expect, test } from "bun:test";
import { COMPUTER_USE_METHODS, isDirectMethod, TOOL_INPUT_SCHEMAS, validateDirectArguments } from "./tools";

describe("direct tool definitions", () => {
  test("recognizes only reviewed Computer Use methods", () => {
    // Arrange
    const candidates = [...COMPUTER_USE_METHODS, "shell", "exec"];

    // Act
    const results = candidates.map((candidate) => isDirectMethod(candidate));

    // Assert
    expect(results.slice(0, COMPUTER_USE_METHODS.length).every(Boolean)).toBe(true);
    expect(results.slice(-2)).toEqual([false, false]);
  });

  test("validates required arguments while retaining compatible additional arguments", () => {
    // Arrange
    const input = { app: "/Applications/TextEdit.app", key: "CMD+A", futureOption: true };

    // Act
    const result = validateDirectArguments("press_key", input);

    // Assert
    expect(result).toEqual(input);
    expect(() => validateDirectArguments("press_key", { app: "TextEdit" })).toThrow();
  });

  test("publishes a schema for every direct method", () => {
    // Arrange
    const methods = [...COMPUTER_USE_METHODS];

    // Act
    const schemas = methods.map((method) => TOOL_INPUT_SCHEMAS[method]);

    // Assert
    expect(schemas).toHaveLength(10);
    expect(schemas.every((schema) => schema.type === "object")).toBe(true);
  });
});

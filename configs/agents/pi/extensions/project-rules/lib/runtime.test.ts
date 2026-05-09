import { describe, expect, test } from "bun:test";
import { createProjectRulesRuntime } from "./runtime";

describe("createProjectRulesRuntime", () => {
  test("creates a complete runtime", () => {
    // Arrange
    const runtime = createProjectRulesRuntime();

    // Act
    const discoverType = typeof runtime.discover;

    // Assert
    expect(discoverType).toBe("function");
  });
});

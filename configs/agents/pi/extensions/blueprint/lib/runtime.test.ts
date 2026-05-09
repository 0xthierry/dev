import { describe, expect, test } from "bun:test";
import { createBlueprintRuntime } from "./runtime";

describe("createBlueprintRuntime", () => {
  test("creates the production runtime", () => {
    // Arrange / Act
    const runtime = createBlueprintRuntime();

    // Assert
    expect(typeof runtime.discoverBlueprints).toBe("function");
    expect(typeof runtime.runBlueprint).toBe("function");
  });
});

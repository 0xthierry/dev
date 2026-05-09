import { describe, expect, test } from "bun:test";
import { createAgentsRuntime } from "./runtime";

describe("createAgentsRuntime", () => {
  test("creates a complete runtime", () => {
    // Arrange / Act
    const runtime = createAgentsRuntime();

    // Assert
    expect(runtime.createSession).toBeFunction();
    expect(runtime.discoverForTarget).toBeFunction();
  });
});

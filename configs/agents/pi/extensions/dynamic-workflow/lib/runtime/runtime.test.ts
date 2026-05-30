import { describe, expect, test } from "bun:test";
import { createDynamicWorkflowRuntime } from "./runtime";

describe("createDynamicWorkflowRuntime", () => {
  test("creates the concrete runtime boundary", () => {
    // Arrange / Act
    const runtime = createDynamicWorkflowRuntime();

    // Assert
    expect(typeof runtime.createRunArtifacts).toBe("function");
    expect(typeof runtime.runAgent).toBe("function");
  });
});

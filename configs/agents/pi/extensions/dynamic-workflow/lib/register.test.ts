import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerDynamicWorkflowTools } from "./register";
import type { DynamicWorkflowRuntime } from "./runtime/types";

function fakeRuntime(): DynamicWorkflowRuntime {
  return {
    createRunArtifacts: mock(async () => ({
      runId: "run-1",
      runDir: "/tmp/run-1",
      sessionsDir: "/tmp/run-1/sessions",
      writeScript: mock(async () => undefined),
    })),
    runAgent: mock(async () => {
      throw new Error("not used");
    }),
  };
}

describe("dynamic workflow registration", () => {
  test("registers the workflow tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerDynamicWorkflowTools(fakePi.pi, fakeRuntime());

    // Assert
    expect(fakePi.tools.has("workflow")).toBe(true);
  });
});

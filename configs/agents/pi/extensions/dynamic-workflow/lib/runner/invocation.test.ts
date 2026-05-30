import { afterEach, describe, expect, test } from "bun:test";
import { delimiter } from "node:path";
import type { WorkflowChildAgentRequest } from "../runtime/types";
import {
  buildWorkflowChildInvocation,
  childEnvironment,
  shouldRegisterWorkflowInCurrentProcess,
  WORKFLOW_CHILD_EXTENSIONS_ENV,
  WORKFLOW_CHILD_NO_EXTENSIONS_ENV,
  WORKFLOW_CHILD_UNSET_ENV,
  WORKFLOW_DEPTH_ENV,
} from "./invocation";

const originalEnv = { ...process.env };

function request(): WorkflowChildAgentRequest {
  return {
    runId: "run-1",
    runDir: "/tmp/run-1",
    sessionsDir: "/tmp/run-1/sessions",
    cwd: "/repo",
    index: 1,
    label: "repo inventory",
    prompt: "Inspect files.",
    modelRef: "provider/model",
    thinking: "low",
  };
}

describe("workflow child invocation", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("builds a child Pi JSON invocation", () => {
    // Arrange
    process.env[WORKFLOW_CHILD_NO_EXTENSIONS_ENV] = "1";
    process.env[WORKFLOW_CHILD_EXTENSIONS_ENV] = ["./a.ts", "./b.ts"].join(delimiter);

    // Act
    const invocation = buildWorkflowChildInvocation(request(), undefined);

    // Assert
    expect(invocation.args).toContain("--mode");
    expect(invocation.args).toContain("json");
    expect(invocation.args).toContain("--no-extensions");
    expect(invocation.args).toContain("--session-dir");
    expect(invocation.args).toContain("provider/model");
    expect(invocation.args.at(-1)).toContain("Inspect files.");
  });

  test("increments depth and removes configured env names", () => {
    // Arrange
    process.env[WORKFLOW_DEPTH_ENV] = "2";
    process.env[WORKFLOW_CHILD_UNSET_ENV] = "SECRET_ONE, SECRET_TWO";
    process.env.SECRET_ONE = "one";
    process.env.SECRET_TWO = "two";

    // Act
    const env = childEnvironment(process.env);

    // Assert
    expect(env[WORKFLOW_DEPTH_ENV]).toBe("3");
    expect(env.SECRET_ONE).toBeUndefined();
    expect(env.SECRET_TWO).toBeUndefined();
  });

  test("does not register inside child workflow processes", () => {
    // Arrange
    const parentEnv = { [WORKFLOW_DEPTH_ENV]: "0" };
    const childEnv = { [WORKFLOW_DEPTH_ENV]: "1" };

    // Act
    const parent = shouldRegisterWorkflowInCurrentProcess(parentEnv);
    const child = shouldRegisterWorkflowInCurrentProcess(childEnv);

    // Assert
    expect(parent).toBe(true);
    expect(child).toBe(false);
  });
});

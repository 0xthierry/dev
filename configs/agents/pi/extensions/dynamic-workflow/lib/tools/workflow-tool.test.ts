import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import type { DynamicWorkflowRuntime, WorkflowChildAgentRequest, WorkflowChildAgentResult } from "../runtime/types";
import { normalizeWorkflowScript, normalizeWorkflowToolArgs, registerWorkflowTool } from "./workflow-tool";

function childResult(request: WorkflowChildAgentRequest): WorkflowChildAgentResult {
  return {
    label: request.label,
    status: "succeeded",
    ok: true,
    output: `child:${request.label}`,
    value: `child:${request.label}`,
    outputTruncated: false,
    stderr: "",
    exitCode: 0,
    activity: [],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 2, turns: 1 },
  };
}

function fakeRuntime(): DynamicWorkflowRuntime {
  return {
    createRunArtifacts: mock(async () => ({
      runId: "run-1",
      runDir: "/tmp/run-1",
      sessionsDir: "/tmp/run-1/sessions",
      writeScript: mock(async () => undefined),
    })),
    runAgent: mock(async (request) => childResult(request)),
  };
}

describe("workflow tool", () => {
  test("normalizes fenced scripts", () => {
    // Arrange
    const script = "```js\nexport const meta = { name: 'demo', description: 'desc' }\nreturn true\n```";

    // Act
    const result = normalizeWorkflowScript(script);

    // Assert
    expect(result).toBe("export const meta = { name: 'demo', description: 'desc' }\nreturn true");
  });

  test("rejects missing script arguments", () => {
    // Arrange
    const args = { args: {} };

    // Act / Assert
    expect(() => normalizeWorkflowToolArgs(args)).toThrow(/script/);
  });

  test("registers and executes the workflow tool", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();
    registerWorkflowTool(fakePi.pi, runtime);
    const script = `export const meta = { name: 'demo', description: 'desc' }
const result = await agent('Inspect files', { label: 'inspect files' })
return { result }
`;

    // Act
    const result = await fakePi.runTool("workflow", { script });

    // Assert
    expect(fakePi.tools.has("workflow")).toBe(true);
    expect(runtime.createRunArtifacts).toHaveBeenCalledTimes(1);
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain("child:inspect files");
    expect(JSON.stringify(result)).toContain("/tmp/run-1");
  });
});

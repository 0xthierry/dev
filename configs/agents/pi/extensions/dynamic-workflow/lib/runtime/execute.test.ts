import { describe, expect, mock, test } from "bun:test";
import { runDynamicWorkflow } from "./execute";
import type { WorkflowAgentRunner, WorkflowChildAgentRequest, WorkflowChildAgentResult } from "./types";

function childResult(request: WorkflowChildAgentRequest, value: unknown): WorkflowChildAgentResult {
  return {
    label: request.label,
    status: "succeeded",
    ok: true,
    output: typeof value === "string" ? value : JSON.stringify(value),
    value,
    outputTruncated: false,
    stderr: "",
    exitCode: 0,
    activity: [],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 2, turns: 1 },
  };
}

function failedChildResult(request: WorkflowChildAgentRequest): WorkflowChildAgentResult {
  return {
    ...childResult(request, null),
    status: "failed",
    ok: false,
    output: "failed",
    value: null,
    exitCode: 1,
    errorMessage: "failed",
  };
}

function baseOptions(agentRunner: WorkflowAgentRunner) {
  return {
    cwd: "/repo",
    runId: "run-1",
    runDir: "/tmp/run-1",
    sessionsDir: "/tmp/run-1/sessions",
    agentRunner,
  };
}

describe("runDynamicWorkflow", () => {
  test("runs agents and returns workflow result", async () => {
    // Arrange
    const runner: WorkflowAgentRunner = {
      runAgent: mock(async (request) => childResult(request, `output:${request.label}`)),
    };
    const script = `export const meta = { name: 'demo', description: 'desc', phases: [{ title: 'Scan' }] }
phase('Scan')
const first = await agent('Inspect files', { label: 'inspect files' })
return { first, cwd }
`;

    // Act
    const result = await runDynamicWorkflow(script, baseOptions(runner));

    // Assert
    expect(result.meta.name).toBe("demo");
    expect(result.result).toEqual({ first: "output:inspect files", cwd: "/repo" });
    expect(result.agentCount).toBe(1);
    expect(runner.runAgent).toHaveBeenCalledTimes(1);
  });

  test("runs parallel thunks and preserves result order", async () => {
    // Arrange
    const runner: WorkflowAgentRunner = {
      runAgent: mock(async (request) => childResult(request, request.label)),
    };
    const script = `export const meta = { name: 'demo', description: 'desc' }
const items = ['a', 'b', 'c']
const results = await parallel(items.map(item => () => agent('Task ' + item, { label: item })))
return results
`;

    // Act
    const result = await runDynamicWorkflow(script, baseOptions(runner));

    // Assert
    expect(result.result).toEqual(["a", "b", "c"]);
    expect(runner.runAgent).toHaveBeenCalledTimes(3);
  });

  test("logs failed agents and returns null for that branch", async () => {
    // Arrange
    const runner: WorkflowAgentRunner = {
      runAgent: mock(async (request) => failedChildResult(request)),
    };
    const logs: string[] = [];
    const script = `export const meta = { name: 'demo', description: 'desc' }
const result = await agent('Fail please', { label: 'failing branch' })
return { result }
`;

    // Act
    const result = await runDynamicWorkflow(script, { ...baseOptions(runner), onLog: (message) => logs.push(message) });

    // Assert
    expect(result.result).toEqual({ result: null });
    expect(logs.join("\n")).toContain("agent failing branch failed");
  });

  test("rejects passing promises directly to parallel", async () => {
    // Arrange
    const runner: WorkflowAgentRunner = {
      runAgent: mock(async (request) => childResult(request, request.label)),
    };
    const script = `export const meta = { name: 'demo', description: 'desc' }
return await parallel([agent('Task', { label: 'bad' })])
`;

    // Act / Assert
    await expect(runDynamicWorkflow(script, baseOptions(runner))).rejects.toThrow(/functions, not promises/);
  });

  test("enforces maximum agent count", async () => {
    // Arrange
    const runner: WorkflowAgentRunner = {
      runAgent: mock(async (request) => childResult(request, request.label)),
    };
    const script = `export const meta = { name: 'demo', description: 'desc' }
await agent('one', { label: 'one' })
await agent('two', { label: 'two' })
return true
`;

    // Act / Assert
    await expect(runDynamicWorkflow(script, { ...baseOptions(runner), maxAgents: 1 })).rejects.toThrow(/maximum agent/);
  });
});

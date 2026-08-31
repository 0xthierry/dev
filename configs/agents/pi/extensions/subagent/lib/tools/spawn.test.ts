import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { registerAgentSpawnTool } from "./spawn";
import { createFakeToolsRuntime, EXECUTION } from "./test-support";

test("normalizes spawn input and calls the supervisor", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentSpawnTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_spawn", {
    task_name: "task",
    subagent_type: "worker",
    prompt: "Do work",
    execution: { provider: "test", model: "model" },
  });

  // Assert
  expect(runtime.resolveExecution).toHaveBeenCalledTimes(1);
  expect(runtime.supervisor.spawn).toHaveBeenCalledWith(
    expect.objectContaining({
      taskName: "task",
      agentType: "worker",
      prompt: "Do work",
      execution: EXECUTION,
      context: { kind: "isolated" },
    }),
  );
  expect(result).toMatchObject({ details: { ok: true, operation: "agent_spawn" } });
});

test("rejects an incomplete model reference before resolution", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentSpawnTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_spawn", {
    task_name: "task",
    subagent_type: "worker",
    prompt: "Do work",
    execution: { model: "model" },
  });

  // Assert
  expect(runtime.supervisor.spawn).not.toHaveBeenCalled();
  expect(result).toMatchObject({ details: { ok: false, error: { kind: "incomplete_model_reference" } } });
});

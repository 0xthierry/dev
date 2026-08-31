import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { registerAgentFollowupTool } from "./followup";
import { createFakeToolsRuntime, EXECUTION } from "./test-support";

test("resolves optional execution and queues a follow-up", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentFollowupTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_followup", {
    target: "agent-1",
    message: "Next task",
    execution: { effort: "high" },
  });

  // Assert
  expect(runtime.resolveExecution).toHaveBeenCalledTimes(1);
  expect(runtime.supervisor.followup).toHaveBeenCalledWith(
    expect.objectContaining({ target: "agent-1", message: "Next task", execution: EXECUTION }),
  );
  expect(result).toMatchObject({ details: { ok: true } });
});

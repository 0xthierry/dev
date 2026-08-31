import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { registerAgentInterruptTool } from "./interrupt";
import { createFakeToolsRuntime } from "./test-support";

test("interrupts the exact target through the supervisor", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentInterruptTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_interrupt", { target: "agent-1" });

  // Assert
  expect(runtime.supervisor.interrupt).toHaveBeenCalledWith("agent-1", undefined);
  expect(result).toMatchObject({ details: { ok: true } });
});

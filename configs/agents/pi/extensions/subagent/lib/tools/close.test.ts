import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { registerAgentCloseTool } from "./close";
import { createFakeToolsRuntime } from "./test-support";

test("closes the exact target through the supervisor", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentCloseTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_close", { target: "/root/task" });

  // Assert
  expect(runtime.supervisor.close).toHaveBeenCalledWith("/root/task", undefined);
  expect(result).toMatchObject({ details: { ok: true, result: { status: "closed" } } });
});

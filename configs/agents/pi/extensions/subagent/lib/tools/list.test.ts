import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { registerAgentListTool } from "./list";
import { createFakeToolsRuntime } from "./test-support";

test("lists agents through the supervisor with an empty schema", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentListTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_list", {});

  // Assert
  expect(runtime.supervisor.list).toHaveBeenCalledWith(undefined);
  expect(result).toMatchObject({ details: { ok: true, result: [{ agentPath: "/root/task" }] } });
  expect(fakePi.tools.get("agent_list")?.parameters).toMatchObject({ type: "object", properties: {} });
});

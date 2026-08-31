import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { DEFAULT_MAILBOX_LIMITS } from "../supervisor/mailbox";
import { registerAgentSendTool } from "./send";
import { createFakeToolsRuntime } from "./test-support";

test("sends communication through the supervisor", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentSendTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_send", { target: "/root/task", message: "Status?" });

  // Assert
  expect(runtime.supervisor.send).toHaveBeenCalledWith(
    expect.objectContaining({ target: "/root/task", message: "Status?" }),
  );
  expect(result).toMatchObject({ details: { ok: true } });
});

test("rejects communication above the shared 16 KiB cap", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentSendTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_send", {
    target: "agent-1",
    message: "x".repeat(DEFAULT_MAILBOX_LIMITS.maxMessageBytes + 1),
  });

  // Assert
  expect(runtime.supervisor.send).not.toHaveBeenCalled();
  expect(result).toMatchObject({ details: { ok: false, error: { kind: "message_too_large" } } });
});

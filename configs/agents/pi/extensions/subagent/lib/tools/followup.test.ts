import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
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

test("renders the target, assignment message, and admitted execution with the shared presentation", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentFollowupTool(fakePi.pi, runtime);
  const definition = fakePi.tools.get("agent_followup") as unknown as {
    renderCall(args: unknown, theme: Theme): { render(width: number): string[] };
    renderResult(result: unknown, options: { expanded: boolean }, theme: Theme): { render(width: number): string[] };
  };
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as unknown as Theme;
  const result = await fakePi.runTool("agent_followup", { target: "/root/task", message: "Run verification" });

  // Act
  const call = definition
    .renderCall({ target: "/root/task", message: "Run verification" }, theme)
    .render(120)
    .map((line) => line.trimEnd());
  const completion = definition
    .renderResult(result, { expanded: false }, theme)
    .render(120)
    .map((line) => line.trimEnd());

  // Assert
  expect(call.join("\n")).toContain("agent_followup /root/task\n  Run verification");
  expect(completion.join("\n")).toContain("✓ agent_followup running · test/model · reasoning medium");
});

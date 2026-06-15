import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/goal");

type JsonObject = Record<string, unknown>;

describe("goal extension E2E", () => {
  let harness: PiRpcHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  test("registers /goal and handles status through Pi RPC", async () => {
    // Arrange
    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      startupTimeoutMs: 20_000,
    });

    // Act
    const commandsResponse = await harness.request({ type: "get_commands" });
    const promptResponse = await harness.request({ type: "prompt", message: "/goal status" });
    const notifyEvent = await harness.waitForEvent(isNoGoalNotifyEvent, 30_000);
    const auditorResponse = await harness.request({ type: "prompt", message: "/goal auditor" });
    const auditorEvent = await harness.waitForEvent(isAuditorStatusNotifyEvent, 30_000);

    // Assert
    expect(commandNames(commandsResponse)).toContain("goal");
    expect(promptResponse.success).toBe(true);
    expect(notifyEvent.message).toContain("No goal is set");
    expect(auditorResponse.success).toBe(true);
    expect(auditorEvent.message).toContain("Goal auditor: mandatory");
    expect(auditorEvent.message).toContain("Latest audit: none");
    expect(harness.stderr()).toBe("");
  }, 60_000);
});

function commandNames(response: JsonObject): string[] {
  const data = response.data as { commands?: Array<{ name?: unknown }> } | undefined;
  return (
    data?.commands?.map((command) => command.name).filter((name): name is string => typeof name === "string") ?? []
  );
}

function isNoGoalNotifyEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes("No goal is set")
  );
}

function isAuditorStatusNotifyEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes("Goal auditor: mandatory")
  );
}

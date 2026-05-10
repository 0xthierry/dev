import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = "configs/agents/pi/extensions/blueprint";

type JsonObject = Record<string, unknown>;

describe("blueprint extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("runs a deterministic blueprint through the /blueprint command", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    const blueprintsDir = join(piAgentDir, "blueprints");
    await mkdir(blueprintsDir, { recursive: true });
    await writeFile(join(blueprintsDir, "echo.jsonc"), `${JSON.stringify(echoBlueprint(), null, 2)}\n`, "utf8");

    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: { PI_CODING_AGENT_DIR: piAgentDir },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "/blueprint echo say hello" }, 60_000);
    const messageEvent = await harness.waitForEvent(isBlueprintProgressMessageEnd, 60_000);

    // Assert
    expect(response.success).toBe(true);
    expect(message(messageEvent)?.content).toContain("Blueprint user/echo succeeded");
    expect(message(messageEvent)?.details).toMatchObject({
      blueprint: { id: "user/echo" },
      progress: { status: "succeeded" },
    });
    expect(harness.events.filter(isBlueprintProgressMessageEnd)).toHaveLength(1);
    expect(harness.events.filter(isBlueprintWorkflowWidget)).toHaveLength(0);
    expect(harness.events.filter(isBlueprintStatusSet)).toHaveLength(0);
    expect(harness.events.filter(isBlueprintSuccessNotification)).toHaveLength(0);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function echoBlueprint() {
  return {
    name: "echo",
    description: "E2E deterministic blueprint",
    start: "echo",
    nodes: {
      echo: { type: "command", run: "printf 'Blueprint E2E deterministic result.'", next: "done" },
      done: { type: "stop", message: "E2E blueprint done." },
    },
  };
}

function isBlueprintSuccessNotification(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes("Blueprint user/echo succeeded.")
  );
}

function isBlueprintProgressMessageEnd(event: JsonObject): boolean {
  return event.type === "message_end" && message(event)?.customType === "blueprint-progress";
}

function isBlueprintWorkflowWidget(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setWidget" &&
    event.widgetKey === "blueprint" &&
    Array.isArray(event.widgetLines)
  );
}

function isBlueprintStatusSet(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setStatus" &&
    event.statusKey === "blueprint" &&
    typeof event.statusText === "string" &&
    event.statusText.length > 0
  );
}

function message(event: JsonObject): JsonObject | undefined {
  const value = event.message;
  return value && typeof value === "object" ? (value as JsonObject) : undefined;
}

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
    await writeFile(join(blueprintsDir, "echo.json"), JSON.stringify(echoBlueprint(), null, 2), "utf8");

    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: { PI_CODING_AGENT_DIR: piAgentDir },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "/blueprint echo say hello" }, 60_000);
    const notifyEvent = await harness.waitForEvent(isBlueprintSuccessNotification, 60_000);

    // Assert
    expect(response.success).toBe(true);
    expect(notifyEvent.message).toContain("Blueprint user/echo succeeded.");
    expect(notifyEvent.message).toContain("Nodes: 3/3 succeeded.");
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function echoBlueprint() {
  return {
    name: "echo",
    description: "E2E deterministic blueprint",
    start: "hydrate",
    nodes: {
      hydrate: { type: "hydrate", next: "echo" },
      echo: { type: "command", run: "printf 'Blueprint E2E deterministic result.'", next: "done" },
      done: { type: "final", message: "E2E blueprint done." },
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

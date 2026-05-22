import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/excalidraw-session");

type JsonObject = Record<string, unknown>;

describe("excalidraw-session extension E2E", () => {
  const harnesses: PiRpcHarness[] = [];

  afterEach(async () => {
    for (const harness of [...harnesses].reverse()) await harness.stop();
    harnesses.length = 0;
  });

  test("shows bridge status through the Excalidraw command", async () => {
    // Arrange
    const port = await findFreePort();
    const harness = await startHarness(port);

    // Act
    const response = await harness.request({ type: "prompt", message: "/excalidraw status" });
    const statusMessage = await harness.waitForEvent(isExcalidrawStatusMessage, 30_000);

    // Assert
    expect(response.success).toBe(true);
    expect(messageContent(statusMessage)).toContain("Excalidraw bridge is running.");
    expect(messageContent(statusMessage)).toContain("Bridge mode: owner.");
    expect(messageContent(statusMessage)).toContain("Connected tabs: 0.");
    expect(harness.stderr()).toBe("");
  }, 60_000);

  test("multiple Pi sessions share one Excalidraw bridge port", async () => {
    // Arrange
    const port = await findFreePort();
    const owner = await startHarness(port);
    const attached = await startHarness(port);

    // Act
    await wait(250);
    await owner.request({ type: "prompt", message: "/excalidraw status" });
    await attached.request({ type: "prompt", message: "/excalidraw status" });
    await wait(250);
    const statusText = [...owner.events, ...attached.events]
      .filter(isExcalidrawStatusMessage)
      .map(messageContent)
      .join("\n---\n");

    // Assert
    expect(statusText).toContain("Bridge mode: owner.");
    expect(statusText).toContain("Bridge mode: attached.");
    expect(owner.stderr()).not.toContain("EADDRINUSE");
    expect(attached.stderr()).not.toContain("EADDRINUSE");
  }, 60_000);

  async function startHarness(port: number): Promise<PiRpcHarness> {
    const harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: { PI_EXCALIDRAW_BRIDGE_PORT: String(port) },
    });
    harnesses.push(harness);
    return harness;
  }
});

function isExcalidrawStatusMessage(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    messageContent(event).includes("Excalidraw bridge")
  );
}

function messageContent(event: JsonObject): string {
  return typeof event.message === "string" ? event.message : "";
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

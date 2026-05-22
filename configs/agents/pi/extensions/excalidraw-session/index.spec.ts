import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/excalidraw-session");

type JsonObject = Record<string, unknown>;

describe("excalidraw-session extension E2E", () => {
  let harness: PiRpcHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  test("shows bridge status through the Excalidraw command", async () => {
    // Arrange
    const port = await findFreePort();
    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: { PI_EXCALIDRAW_BRIDGE_PORT: String(port) },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "/excalidraw status" });
    const statusMessage = await harness.waitForEvent(isExcalidrawStatusMessage, 30_000);

    // Assert
    expect(response.success).toBe(true);
    expect(messageContent(statusMessage)).toContain("Excalidraw bridge is running.");
    expect(messageContent(statusMessage)).toContain("Connected tabs: 0.");
    expect(harness.stderr()).toBe("");
  }, 60_000);
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

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

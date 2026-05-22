import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { createExcalidrawBridgeServer, type ExcalidrawBridge, isAllowedOrigin } from "./bridge-server";

describe("createExcalidrawBridgeServer", () => {
  let bridge: ExcalidrawBridge | undefined;

  afterEach(async () => {
    // Arrange
    const activeBridge = bridge;

    // Act
    bridge = undefined;
    await activeBridge?.stop();

    // Assert
    expect(true).toBe(true);
  });

  test("starts and reports an empty running bridge", async () => {
    // Arrange
    const port = await findFreePort();
    bridge = createExcalidrawBridgeServer({ port });

    // Act
    await bridge.start();
    const status = bridge.getStatus();

    // Assert
    expect(status.running).toBe(true);
    expect(status.host).toBe("127.0.0.1");
    expect(status.port).toBe(port);
    expect(status.clients).toEqual([]);
    expect(status.activeTabId).toBeUndefined();
  });

  test("stops and reports a stopped bridge", async () => {
    // Arrange
    const port = await findFreePort();
    bridge = createExcalidrawBridgeServer({ port });
    await bridge.start();

    // Act
    await bridge.stop();
    const status = bridge.getStatus();

    // Assert
    expect(status.running).toBe(false);
    expect(status.clients).toEqual([]);
  });

  test("reports timeout errors when no connected tab responds", async () => {
    // Arrange
    const port = await findFreePort();
    bridge = createExcalidrawBridgeServer({ port, requestTimeoutMs: 10 });
    await bridge.start();

    // Act
    const result = bridge.request("capture_view");

    // Assert
    await expect(result).rejects.toThrow("No Excalidraw browser tab is connected");
  });
});

describe("isAllowedOrigin", () => {
  test("allows configured origins and rejects unconfigured origins", () => {
    // Arrange
    const allowed = new Set(["http://excalidraw.localhost"]);

    // Act
    const local = isAllowedOrigin("http://excalidraw.localhost", allowed);
    const missing = isAllowedOrigin(undefined, allowed);
    const remote = isAllowedOrigin("https://example.com", allowed);

    // Assert
    expect(local).toBe(true);
    expect(missing).toBe(true);
    expect(remote).toBe(false);
  });
});

async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a test port.");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

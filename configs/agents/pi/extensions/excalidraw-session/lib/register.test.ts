import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { ExcalidrawBridge } from "./bridge-server";
import { type ExcalidrawRuntime, registerExcalidrawSession } from "./register";

describe("registerExcalidrawSession", () => {
  test("registers the status command and always-available canvas tool", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createFakeRuntime();

    // Act
    registerExcalidrawSession(fakePi.pi, runtime);

    // Assert
    expect(fakePi.commands.has("excalidraw")).toBe(true);
    expect(fakePi.tools.has("excalidraw_canvas")).toBe(true);
    expect(fakePi.activeTools.has("excalidraw_canvas")).toBe(true);
  });

  test("offers command autocomplete for status", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createFakeRuntime();
    registerExcalidrawSession(fakePi.pi, runtime);
    const command = fakePi.commands.get("excalidraw");

    // Act
    const completions = command?.getArgumentCompletions?.("sta");

    // Assert
    expect(completions).toEqual([{ value: "status", label: "status", description: "Show bridge status" }]);
  });

  test("command starts the bridge and sends status in non-UI mode", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createFakeRuntime();
    registerExcalidrawSession(fakePi.pi, runtime);

    // Act
    await fakePi.runCommand("excalidraw", "status");

    // Assert
    expect(runtime.bridge.start).toHaveBeenCalledTimes(1);
    expect(fakePi.sentMessages).toHaveLength(1);
    expect(String((fakePi.sentMessages[0].message as { content: unknown }).content)).toContain(
      "Excalidraw bridge is running.",
    );
  });

  test("session_start starts the bridge", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createFakeRuntime();
    registerExcalidrawSession(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start");

    // Assert
    expect(runtime.bridge.start).toHaveBeenCalledTimes(1);
  });

  test("session_shutdown stops the bridge", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createFakeRuntime();
    registerExcalidrawSession(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_shutdown");

    // Assert
    expect(runtime.bridge.stop).toHaveBeenCalledTimes(1);
  });
});

function createFakeRuntime(): ExcalidrawRuntime {
  return { bridge: createFakeBridge() };
}

function createFakeBridge(): ExcalidrawBridge {
  return {
    start: mock(async () => undefined),
    stop: mock(async () => undefined),
    getStatus: mock(() => ({
      running: true,
      host: "127.0.0.1",
      port: 19275,
      activeTabId: "tab-1",
      clients: [],
    })),
    request: mock(async () => ({ scene: { elements: [] }, viewport: {} })),
  };
}

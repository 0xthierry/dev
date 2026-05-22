import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { ExcalidrawBridge } from "./bridge-server";
import { registerExcalidrawCanvasTool } from "./tool";

describe("registerExcalidrawCanvasTool", () => {
  test("registers excalidraw_canvas", () => {
    // Arrange
    const fakePi = createFakePi();
    const bridge = createFakeBridge();

    // Act
    registerExcalidrawCanvasTool(fakePi.pi, bridge);

    // Assert
    expect(fakePi.tools.has("excalidraw_canvas")).toBe(true);
    expect(fakePi.activeTools.has("excalidraw_canvas")).toBe(true);
  });

  test("documents safe editing semantics in the model-facing prompt", () => {
    // Arrange
    const fakePi = createFakePi();
    const bridge = createFakeBridge();

    // Act
    registerExcalidrawCanvasTool(fakePi.pi, bridge);
    const tool = fakePi.tools.get("excalidraw_canvas");

    // Assert
    expect(tool?.description).toContain("Inspect or control");
    expect(tool?.promptGuidelines).toContain(
      "Prefer action add_elements when adding new boxes, arrows, or labels. add_elements appends to the current canvas and does not delete existing elements.",
    );
    expect(tool?.promptGuidelines).toContain(
      "Use action update_scene only for deliberate whole-scene replacement or appState/files updates. If elements is supplied to update_scene, it is the complete replacement element list, so include every existing element you want to keep.",
    );
  });

  test("returns local status without requiring a connected tab", async () => {
    // Arrange
    const fakePi = createFakePi();
    const bridge = createFakeBridge();
    registerExcalidrawCanvasTool(fakePi.pi, bridge);

    // Act
    const result = (await fakePi.runTool("excalidraw_canvas", { action: "status" })) as ToolResult;

    // Assert
    expect(bridge.start).toHaveBeenCalledTimes(1);
    expect(bridge.request).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Excalidraw bridge is running.");
  });

  test("returns image content for capture_view", async () => {
    // Arrange
    const fakePi = createFakePi();
    const bridge = createFakeBridge({ requestResult: { data: "abc123", mimeType: "image/png" } });
    registerExcalidrawCanvasTool(fakePi.pi, bridge);

    // Act
    const result = (await fakePi.runTool("excalidraw_canvas", { action: "capture_view" })) as ToolResult;

    // Assert
    expect(bridge.request).toHaveBeenCalledWith("capture_view", {}, { tabId: undefined, timeoutMs: 20_000 });
    expect(result.content).toContainEqual({ type: "image", data: "abc123", mimeType: "image/png" });
  });

  test("passes add_elements payload through the bridge", async () => {
    // Arrange
    const fakePi = createFakePi();
    const bridge = createFakeBridge({ requestResult: { added: 2, elementCount: 40 } });
    registerExcalidrawCanvasTool(fakePi.pi, bridge);
    const elements = [{ id: "rect", type: "rectangle" }];

    // Act
    const result = (await fakePi.runTool("excalidraw_canvas", {
      action: "add_elements",
      elements,
      captureUpdate: "IMMEDIATELY",
    })) as ToolResult;

    // Assert
    expect(bridge.request).toHaveBeenCalledWith(
      "add_elements",
      { elements, captureUpdate: "IMMEDIATELY" },
      { tabId: undefined, timeoutMs: 15_000 },
    );
    expect(result.content[0].text).toContain("Canvas now has 40 element(s).");
  });

  test("passes update_scene payload through the bridge", async () => {
    // Arrange
    const fakePi = createFakePi();
    const bridge = createFakeBridge({ requestResult: { updated: true, elementCount: 1 } });
    registerExcalidrawCanvasTool(fakePi.pi, bridge);
    const elements = [{ id: "rect", type: "rectangle" }];

    // Act
    const result = (await fakePi.runTool("excalidraw_canvas", {
      action: "update_scene",
      elements,
      captureUpdate: "IMMEDIATELY",
    })) as ToolResult;

    // Assert
    expect(bridge.request).toHaveBeenCalledWith(
      "update_scene",
      { elements, captureUpdate: "IMMEDIATELY" },
      { tabId: undefined, timeoutMs: 15_000 },
    );
    expect(result.content[0].text).toContain("Canvas now has 1 element(s).");
  });
});

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
};

type FakeBridgeOptions = {
  requestResult?: unknown;
};

function createFakeBridge(options: FakeBridgeOptions = {}): ExcalidrawBridge {
  return {
    start: mock(async () => undefined),
    stop: mock(async () => undefined),
    getStatus: mock(() => ({
      running: true,
      mode: "owner" as const,
      host: "127.0.0.1",
      port: 19275,
      activeTabId: "tab-1",
      clients: [],
    })),
    request: mock(async () => options.requestResult ?? { scene: { elements: [] }, viewport: {} }),
  };
}

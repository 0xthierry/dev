import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createExcalidrawBridgeServer, type ExcalidrawBridge } from "./bridge-server";
import { summarizeStatus } from "./scene-summary";
import { registerExcalidrawCanvasTool } from "./tool";

const MESSAGE_TYPE = "excalidraw-status";

export type ExcalidrawRuntime = {
  bridge: ExcalidrawBridge;
};

export function createExcalidrawRuntime(): ExcalidrawRuntime {
  return { bridge: createExcalidrawBridgeServer({ port: configuredBridgePort() }) };
}

function configuredBridgePort(): number {
  const value = Number(process.env.PI_EXCALIDRAW_BRIDGE_PORT ?? "19275");
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : 19275;
}

export function registerExcalidrawSessionExtension(pi: ExtensionAPI): void {
  registerExcalidrawSession(pi, createExcalidrawRuntime());
}

export function registerExcalidrawSession(pi: ExtensionAPI, runtime: ExcalidrawRuntime): void {
  registerExcalidrawCanvasTool(pi, runtime.bridge);

  pi.registerCommand("excalidraw", {
    description: "Show local Excalidraw bridge status. The excalidraw_canvas tool is always available.",
    getArgumentCompletions(prefix: string) {
      const item = { value: "status", label: "status", description: "Show bridge status" };
      return item.value.startsWith(prefix.trim()) ? [item] : null;
    },
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await runtime.bridge.start();
      const status = runtime.bridge.getStatus();
      const content = summarizeStatus(status);
      if (ctx.hasUI) {
        ctx.ui.notify(content, "info");
        return;
      }
      pi.sendMessage({ customType: MESSAGE_TYPE, content, display: true, details: status });
    },
  });

  pi.on("session_start", async (_event, _ctx: ExtensionContext) => {
    try {
      await runtime.bridge.start();
    } catch {
      // Keep startup quiet. /excalidraw status and excalidraw_canvas surface actionable bridge errors.
    }
  });

  pi.on("session_shutdown", async () => {
    await runtime.bridge.stop();
  });
}

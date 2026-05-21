import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLspRuntime, type LspRuntime } from "./runtime";
import { buildStatusMessage, statusLevel } from "./status";
import { registerLspTools } from "./tools";

const STATUS_KEY = "thierry-lsp";
const MESSAGE_TYPE = "lsp";

export function registerLspExtension(pi: ExtensionAPI): void {
  registerLsp(pi, createLspRuntime());
}

export function registerLsp(pi: ExtensionAPI, runtime: LspRuntime): void {
  registerLspTools(pi, runtime, STATUS_KEY);

  pi.registerCommand("lsp", {
    description: "Show configured LSP commands and whether each command is available on PATH.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const loaded = runtime.load(ctx.cwd);
      const content = buildStatusMessage(loaded.adapters, ctx.cwd);
      if (ctx.hasUI) {
        ctx.ui.notify(content, statusLevel(loaded.adapters, ctx.cwd));
        return;
      }
      pi.sendMessage({
        customType: MESSAGE_TYPE,
        content,
        display: true,
        details: { servers: loaded.adapters.length },
      });
    },
  });

  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}

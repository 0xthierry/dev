import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyCodexFastMode, supportsCodexFastMode } from "./payload";

const STATE_KEY = "codex-fast-mode";

export function registerCodexFastModeExtension(pi: ExtensionAPI): void {
  let enabled = true;

  const updateStatus = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus(
      STATE_KEY,
      supportsCodexFastMode(ctx.model) ? ctx.ui.theme.fg(enabled ? "success" : "dim", "[fast]") : undefined,
    );
  };

  const restore = (ctx: ExtensionContext) => {
    enabled = true;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== STATE_KEY) continue;
      const data: unknown = entry.data;
      if (data && typeof data === "object" && "enabled" in data && typeof data.enabled === "boolean") {
        enabled = data.enabled;
      }
    }
    updateStatus(ctx);
  };

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("model_select", (_event, ctx) => updateStatus(ctx));

  pi.registerCommand("fast", {
    description: "Show or set GPT fast mode: /fast [on|off]",
    getArgumentCompletions: (prefix) => {
      const items = ["on", "off"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const mode = args.trim().toLowerCase();
      if (mode !== "" && mode !== "on" && mode !== "off") {
        if (ctx.hasUI) ctx.ui.notify("Usage: /fast on | /fast off. Use /fast to see the current setting.", "warning");
        return;
      }
      if (mode !== "") {
        enabled = mode === "on";
        pi.appendEntry(STATE_KEY, { enabled });
      }
      updateStatus(ctx);
      if (ctx.hasUI) {
        const unsupported = supportsCodexFastMode(ctx.model) ? "" : " (not applied to the current model/provider)";
        ctx.ui.notify(`GPT fast mode ${enabled ? "on" : "off"}${unsupported}.`, "info");
      }
    },
  });

  pi.on("before_provider_request", (event, ctx) =>
    enabled ? applyCodexFastMode(event.payload, ctx.model) : undefined,
  );
}

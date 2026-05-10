import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleBlueprintCommand } from "./command";
import { createBlueprintAutocompleteProvider, getBlueprintArgumentCompletions } from "./completions";
import { BLUEPRINT_PROGRESS_MESSAGE_TYPE, renderBlueprintProgressMessage } from "./progress-message";
import { shouldRegisterBlueprintInCurrentProcess } from "./runner/pi-invocation";
import { type BlueprintRuntime, createBlueprintRuntime } from "./runtime";

export function registerBlueprintExtension(pi: ExtensionAPI): void {
  if (!shouldRegisterBlueprintInCurrentProcess()) return;
  registerBlueprintCommand(pi, createBlueprintRuntime());
}

export function registerBlueprintCommand(pi: ExtensionAPI, runtime: BlueprintRuntime): void {
  pi.registerMessageRenderer(BLUEPRINT_PROGRESS_MESSAGE_TYPE, renderBlueprintProgressMessage);

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.addAutocompleteProvider((current) => createBlueprintAutocompleteProvider(current, runtime, ctx.cwd));
  });

  pi.registerCommand("blueprint", {
    description: "Run a local blueprint graph with deterministic nodes and isolated child Pi sessions.",
    getArgumentCompletions: (prefix) => getBlueprintArgumentCompletions(runtime, process.cwd(), prefix),
    handler: async (args, ctx) => handleBlueprintCommand(pi, runtime, args, ctx),
  });
}

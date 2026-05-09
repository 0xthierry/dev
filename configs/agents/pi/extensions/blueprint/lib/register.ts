import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleBlueprintCommand } from "./command";
import { shouldRegisterBlueprintInCurrentProcess } from "./runner/pi-invocation";
import { type BlueprintRuntime, createBlueprintRuntime } from "./runtime";

export function registerBlueprintExtension(pi: ExtensionAPI): void {
  if (!shouldRegisterBlueprintInCurrentProcess()) return;
  registerBlueprintCommand(pi, createBlueprintRuntime());
}

export function registerBlueprintCommand(pi: ExtensionAPI, runtime: BlueprintRuntime): void {
  pi.registerCommand("blueprint", {
    description: "Run a local blueprint graph with deterministic nodes and isolated child Pi sessions.",
    handler: async (args, ctx) => handleBlueprintCommand(pi, runtime, args, ctx),
  });
}

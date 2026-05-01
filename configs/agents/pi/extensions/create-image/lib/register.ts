import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getCreateImageArgumentCompletions } from "./arguments";
import { handleCreateImageCommand } from "./command";
import { type CreateImageRuntime, createCreateImageRuntime } from "./runtime";

export function registerCreateImageExtension(pi: ExtensionAPI): void {
  registerCreateImageCommand(pi, createCreateImageRuntime());
}

export function registerCreateImageCommand(pi: ExtensionAPI, runtime: CreateImageRuntime): void {
  pi.registerCommand("create-image", {
    description: "Generate an image from a prompt and save it to the project.",
    getArgumentCompletions: (prefix) => getCreateImageArgumentCompletions(prefix, runtime.providers),
    handler: async (args, ctx) => handleCreateImageCommand(pi, runtime, args, ctx),
  });
}

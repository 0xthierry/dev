import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { handleCreateImageCommand } from "./command";
import { type CreateImageRuntime, createCreateImageRuntime } from "./runtime";

export function registerCreateImageExtension(pi: ExtensionAPI): void {
  registerCreateImageCommand(pi, createCreateImageRuntime());
}

export function registerCreateImageCommand(pi: ExtensionAPI, runtime: CreateImageRuntime): void {
  pi.registerCommand("create-image", {
    description: "Generate an image from a prompt and save it to the project.",
    handler: async (args, ctx) => handleCreateImageCommand(pi, runtime, args, ctx),
  });
}

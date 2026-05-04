import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { handleCommentCommand } from "./command";
import { type CommentRuntime, createCommentRuntime } from "./runtime";

export function registerCommentExtension(pi: ExtensionAPI): void {
  registerCommentCommand(pi, createCommentRuntime());
}

export function registerCommentCommand(pi: ExtensionAPI, runtime: CommentRuntime): void {
  pi.registerCommand("comment", {
    description: "Open the last assistant message in $EDITOR and load the edited quoted text into the editor.",
    handler: async (_args, ctx) => handleCommentCommand(runtime, ctx),
  });
}

import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { extractLastAssistantText, type LastAssistantTextResult } from "./messages";
import { formatQuotedMarkdown } from "./quote";
import type { CommentRuntime } from "./runtime";

export async function handleCommentCommand(runtime: CommentRuntime, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) return;

  await ctx.waitForIdle();

  const lastAssistantText = extractLastAssistantText(ctx.sessionManager.getBranch());
  if (!lastAssistantText.ok) {
    ctx.ui.notify(formatLastAssistantTextError(lastAssistantText), "error");
    return;
  }

  try {
    const editedText = await runtime.editText(formatQuotedMarkdown(lastAssistantText.text));
    ctx.ui.setEditorText(editedText);
    ctx.ui.notify("Loaded edited quoted assistant text into the editor.", "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export function formatLastAssistantTextError(result: Exclude<LastAssistantTextResult, { ok: true }>): string {
  switch (result.reason) {
    case "noAssistantMessage":
      return "No assistant message found on the current branch.";
    case "incompleteAssistantMessage":
      return `Last assistant message is incomplete (${result.stopReason}).`;
    case "assistantMessageHasNoText":
      return "Last assistant message has no text content.";
  }
}

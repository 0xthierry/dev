import type { StopReason } from "@mariozechner/pi-ai";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export type LastAssistantTextResult =
  | { ok: true; text: string }
  | { ok: false; reason: "noAssistantMessage" }
  | { ok: false; reason: "incompleteAssistantMessage"; stopReason: StopReason }
  | { ok: false; reason: "assistantMessageHasNoText" };

export function extractLastAssistantText(branch: SessionEntry[]): LastAssistantTextResult {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message") continue;

    const { message } = entry;
    if (message.role !== "assistant") continue;

    if (message.stopReason !== "stop") {
      return { ok: false, reason: "incompleteAssistantMessage", stopReason: message.stopReason };
    }

    const text = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!text) return { ok: false, reason: "assistantMessageHasNoText" };
    return { ok: true, text };
  }

  return { ok: false, reason: "noAssistantMessage" };
}

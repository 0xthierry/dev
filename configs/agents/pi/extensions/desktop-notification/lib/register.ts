import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatNotification } from "./format-notification";
import { extractLastAssistantText } from "./messages";
import { type DesktopNotifier, writeOsc777Notification } from "./notifier";

export function registerDesktopNotificationExtension(
  pi: ExtensionAPI,
  notify: DesktopNotifier = writeOsc777Notification,
): void {
  pi.on("agent_end", async (event) => {
    const lastText = extractLastAssistantText(event.messages ?? []);
    notify(formatNotification(lastText));
  });
}

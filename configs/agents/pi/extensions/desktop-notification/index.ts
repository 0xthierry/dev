import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerDesktopNotificationExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerDesktopNotificationExtension(pi);
}

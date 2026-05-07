import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDesktopNotificationExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerDesktopNotificationExtension(pi);
}

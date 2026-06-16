import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAmqNotifyExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerAmqNotifyExtension(pi);
}

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWebAccessExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerWebAccessExtension(pi);
}

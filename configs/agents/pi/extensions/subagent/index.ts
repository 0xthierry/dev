import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerSubagentExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerSubagentExtension(pi);
}

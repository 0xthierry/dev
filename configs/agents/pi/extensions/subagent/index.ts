import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerSubagentExtension(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexDetailedReasoningExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCodexDetailedReasoningExtension(pi);
}

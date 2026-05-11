import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentFeedbackExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerAgentFeedbackExtension(pi);
}

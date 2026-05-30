import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDynamicWorkflowExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerDynamicWorkflowExtension(pi);
}

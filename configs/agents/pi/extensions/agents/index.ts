import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentsExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerAgentsExtension(pi);
}

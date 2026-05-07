import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerWebAccessExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerWebAccessExtension(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexFastModeExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCodexFastModeExtension(pi);
}

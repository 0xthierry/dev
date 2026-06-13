import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexCompactionExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCodexCompactionExtension(pi);
}

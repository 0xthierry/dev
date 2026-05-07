import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerStatuslineExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerStatuslineExtension(pi);
}

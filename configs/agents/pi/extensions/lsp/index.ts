import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLspExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerLspExtension(pi);
}

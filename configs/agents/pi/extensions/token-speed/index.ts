import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTokenSpeedExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerTokenSpeedExtension(pi);
}

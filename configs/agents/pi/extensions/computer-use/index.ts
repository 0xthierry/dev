import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerComputerUseExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerComputerUseExtension(pi);
}

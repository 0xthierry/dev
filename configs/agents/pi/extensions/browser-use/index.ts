import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBrowserUseExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerBrowserUseExtension(pi);
}

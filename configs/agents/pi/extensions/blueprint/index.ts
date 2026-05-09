import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBlueprintExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerBlueprintExtension(pi);
}

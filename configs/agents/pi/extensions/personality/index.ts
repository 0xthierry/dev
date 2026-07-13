import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPersonalityExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerPersonalityExtension(pi);
}

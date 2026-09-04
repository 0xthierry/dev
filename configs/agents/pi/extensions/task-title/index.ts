import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerTaskTitleExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerTaskTitleExtension(pi);
}

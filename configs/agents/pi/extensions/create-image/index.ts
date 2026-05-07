import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCreateImageExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCreateImageExtension(pi);
}

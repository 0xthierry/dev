import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCreateImageExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCreateImageExtension(pi);
}

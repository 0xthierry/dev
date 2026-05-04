import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommentExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCommentExtension(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommentExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerCommentExtension(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerFffExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerFffExtension(pi);
}

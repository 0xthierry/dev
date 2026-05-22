import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerExcalidrawSessionExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerExcalidrawSessionExtension(pi);
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerXaiGrokFastModeExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerXaiGrokFastModeExtension(pi);
}

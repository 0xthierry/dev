import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexMultiAuthExtension } from "./lib/register";

export default async function (pi: ExtensionAPI) {
  await registerCodexMultiAuthExtension(pi);
}

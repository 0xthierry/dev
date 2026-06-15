import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerOracleExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerOracleExtension(pi);
}

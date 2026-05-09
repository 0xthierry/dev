import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerProjectRulesExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerProjectRulesExtension(pi);
}

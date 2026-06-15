import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerGoalExtension(pi);
}

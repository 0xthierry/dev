import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyCodexFastMode } from "./payload";

export function registerCodexFastModeExtension(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => applyCodexFastMode(event.payload, ctx.model));
}

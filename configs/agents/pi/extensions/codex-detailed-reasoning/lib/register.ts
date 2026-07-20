import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyCodexDetailedReasoning } from "./payload";

export function registerCodexDetailedReasoningExtension(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event) => applyCodexDetailedReasoning(event.payload));
}

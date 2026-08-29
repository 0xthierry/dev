import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyXaiGrokFastMode } from "./fast-mode";

export function registerXaiGrokFastModeExtension(pi: ExtensionAPI): void {
  pi.on("before_provider_request", (event, ctx) => applyXaiGrokFastMode(event.payload, ctx.model));
}

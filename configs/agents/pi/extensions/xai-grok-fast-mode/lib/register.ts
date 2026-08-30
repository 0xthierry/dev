import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { applyXaiGrokCacheAffinity } from "./cache-affinity";
import { shouldCompactXaiGrok } from "./compaction";
import { applyXaiGrokFastMode } from "./fast-mode";

export function registerXaiGrokFastModeExtension(pi: ExtensionAPI): void {
  let earlyCompactionInFlight = false;

  pi.on("before_provider_request", (event, ctx) => applyXaiGrokFastMode(event.payload, ctx.model));

  pi.on("before_provider_headers", (event, ctx) => {
    applyXaiGrokCacheAffinity(event.headers, ctx.model, safeSessionId(ctx));
  });

  pi.on("turn_end", (_event, ctx) => {
    const currentTokens = ctx.getContextUsage()?.tokens ?? undefined;
    if (earlyCompactionInFlight || !shouldCompactXaiGrok(ctx.model, currentTokens)) return;

    earlyCompactionInFlight = true;
    try {
      ctx.compact({
        onComplete: () => {
          earlyCompactionInFlight = false;
        },
        onError: (error) => {
          earlyCompactionInFlight = false;
          notifyCompactionFailure(ctx, error);
        },
      });
    } catch (error) {
      earlyCompactionInFlight = false;
      notifyCompactionFailure(ctx, error);
    }
  });
}

function safeSessionId(ctx: Pick<ExtensionContext, "sessionManager">): string | undefined {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return undefined;
  }
}

function notifyCompactionFailure(ctx: Pick<ExtensionContext, "hasUI" | "ui">, error: unknown): void {
  if (!ctx.hasUI) return;
  const message = error instanceof Error ? error.message : String(error);
  ctx.ui.notify(`xAI Grok compaction failed: ${message}`, "warning");
}

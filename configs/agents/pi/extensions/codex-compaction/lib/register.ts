import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import { codexAutoCompactionThreshold, extractChatGptAccountId, isCodexResponsesModel } from "./model";
import { portableCompactOnly } from "./portable-recovery";
import { type CompactionPreparation, recoverFromV1Placeholder } from "./recovery";
import { remoteCompact } from "./remote-compaction";
import { applyCompactionReplacement } from "./replacement";
import type { CodexModel, CodexRecoveryInfo, JsonObject } from "./types";

type SessionBeforeCompactResult = {
  cancel?: boolean;
  compaction?: import("@earendil-works/pi-coding-agent").CompactionResult;
};

export type CodexCompactionRuntime = {
  remoteCompact: typeof remoteCompact;
  portableCompactOnly: typeof portableCompactOnly;
};

const EARLY_COMPACTION_RESUME_MESSAGE = {
  customType: "codex-compaction-resume",
  content: "Continue the interrupted task after context compaction.",
  display: false,
} as const;

export function createCodexCompactionRuntime(): CodexCompactionRuntime {
  return { remoteCompact, portableCompactOnly };
}

export function registerCodexCompactionExtension(
  pi: ExtensionAPI,
  runtime: CodexCompactionRuntime = createCodexCompactionRuntime(),
): void {
  let earlyCompactionInFlight = false;

  pi.on("turn_end", (event, ctx) => {
    if (!isCodexResponsesModel(ctx.model) || earlyCompactionInFlight) return;

    const currentTokens = ctx.getContextUsage()?.tokens;
    if (currentTokens == null || currentTokens < codexAutoCompactionThreshold(ctx.model)) return;

    const shouldResumeInterruptedToolLoop =
      event.message.role === "assistant" && event.message.stopReason === "toolUse" && event.toolResults.length > 0;
    earlyCompactionInFlight = true;
    try {
      ctx.compact({
        onComplete: () => {
          earlyCompactionInFlight = false;
          if (shouldResumeInterruptedToolLoop) {
            pi.sendMessage(EARLY_COMPACTION_RESUME_MESSAGE, { deliverAs: "followUp", triggerTurn: true });
          }
        },
        onError: (error) => {
          earlyCompactionInFlight = false;
          if (ctx.hasUI) ctx.ui.notify(`Codex compaction failed: ${error.message}`, "warning");
        },
      });
    } catch (error) {
      earlyCompactionInFlight = false;
      if (ctx.hasUI) {
        ctx.ui.notify(`Codex compaction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    }
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const contextWindow =
      ctx.model && typeof ctx.model.contextWindow === "number" ? ctx.model.contextWindow : undefined;
    const recovery = recoverFromV1Placeholder(event.preparation, event.branchEntries, contextWindow);

    if (recovery?.recovery.truncated) {
      return compactCancel(
        ctx,
        event.signal,
        "Legacy Codex compaction recovery was truncated; canceling to avoid lossy migration",
      );
    }

    if (recovery && !isCodexResponsesModel(ctx.model)) {
      return handlePortableRecovery({
        pi,
        event,
        ctx,
        preparation: recovery.preparation,
        recovery: recovery.recovery,
        runtime,
      });
    }

    if (!isCodexResponsesModel(ctx.model)) return undefined;

    return handleCodexRemoteCompact({
      pi,
      event,
      ctx,
      model: ctx.model,
      preparation: recovery?.preparation ?? event.preparation,
      originalPreparation: event.preparation,
      recovery: recovery?.recovery,
      runtime,
    });
  });

  pi.on("before_provider_request", async (event, ctx) => {
    if (!isCodexResponsesModel(ctx.model)) return undefined;

    let accountHash: string | undefined;
    try {
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
      if (auth.ok && auth.apiKey) {
        const accountId = extractChatGptAccountId(auth.apiKey);
        if (accountId) accountHash = hashAccountId(accountId);
      }
    } catch {
      accountHash = undefined;
    }

    const result = applyCompactionReplacement({
      payload: event.payload,
      model: ctx.model,
      branchEntries: ctx.sessionManager.getBranch(),
      accountHash,
    });

    return result.mutated ? event.payload : undefined;
  });
}

async function handleCodexRemoteCompact(options: {
  pi: ExtensionAPI;
  event: SessionBeforeCompactEvent;
  ctx: ExtensionContext;
  model: CodexModel;
  preparation: CompactionPreparation;
  originalPreparation: CompactionPreparation;
  recovery: CodexRecoveryInfo | undefined;
  runtime: CodexCompactionRuntime;
}): Promise<SessionBeforeCompactResult> {
  const { pi, event, ctx, model, preparation, originalPreparation, recovery, runtime } = options;
  const failureLabel = recovery ? "Codex compaction recovery" : "Codex compaction";

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey) {
      return compactCancel(ctx, event.signal, auth.ok ? `${failureLabel} requires API credentials` : auth.error);
    }

    const accountId = extractChatGptAccountId(auth.apiKey);
    if (!accountId) {
      return compactCancel(ctx, event.signal, `${failureLabel} requires a ChatGPT account id`);
    }

    const compaction = await runtime.remoteCompact({
      preparation,
      originalPreparation,
      model,
      auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
      signal: event.signal,
      thinkingLevel: pi.getThinkingLevel(),
      systemPrompt: ctx.getSystemPrompt(),
      tools: activeToolSpecs(pi),
      sessionId: safeSessionId(ctx),
      branchEntries: event.branchEntries,
      recovery,
    });

    if (!compaction) {
      return compactCancel(
        ctx,
        event.signal,
        event.signal.aborted
          ? undefined
          : `${failureLabel} endpoint failed; portable summary fallback was not attempted`,
      );
    }
    return { compaction };
  } catch (error) {
    if (event.signal.aborted || isAbortError(error)) return compactCancel(ctx, event.signal);
    return compactCancel(ctx, event.signal, error instanceof Error ? error.message : `${failureLabel} endpoint failed`);
  }
}

async function handlePortableRecovery(options: {
  pi: ExtensionAPI;
  event: SessionBeforeCompactEvent;
  ctx: ExtensionContext;
  preparation: CompactionPreparation;
  recovery: CodexRecoveryInfo;
  runtime: CodexCompactionRuntime;
}): Promise<SessionBeforeCompactResult> {
  const { pi, event, ctx, preparation, recovery, runtime } = options;
  if (!ctx.model) return compactCancel(ctx, event.signal, "Codex compaction recovery requires an active model");

  try {
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok) return compactCancel(ctx, event.signal, auth.error || "Compaction recovery auth unavailable");

    const compaction = await runtime.portableCompactOnly({
      preparation,
      model: ctx.model,
      auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
      customInstructions: event.customInstructions,
      signal: event.signal,
      thinkingLevel: pi.getThinkingLevel(),
      recovery,
      branchEntries: event.branchEntries,
    });

    if (!compaction) {
      return compactCancel(ctx, event.signal, event.signal.aborted ? undefined : "Compaction recovery summary failed");
    }
    return { compaction };
  } catch (error) {
    if (event.signal.aborted || isAbortError(error)) return compactCancel(ctx, event.signal);
    return compactCancel(ctx, event.signal, error instanceof Error ? error.message : "Compaction recovery failed");
  }
}

function compactCancel(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  signal: AbortSignal,
  message?: string,
): SessionBeforeCompactResult {
  if (!signal.aborted && message && ctx.hasUI) ctx.ui.notify(message, "warning");
  return { cancel: true };
}

function activeToolSpecs(pi: ExtensionAPI): JsonObject[] {
  const activeNames = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .filter((tool) => activeNames.has(tool.name))
    .map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    }));
}

function safeSessionId(ctx: ExtensionContext): string | undefined {
  try {
    return ctx.sessionManager.getSessionId();
  } catch {
    return undefined;
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  return name === "AbortError" || message.toLowerCase().includes("abort");
}

export type { SessionBeforeCompactEvent };

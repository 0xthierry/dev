import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { hashAccountId } from "./binding";
import { extractChatGptAccountId, isCodexResponsesModel } from "./model";
import { type CompactionPreparation, recoverFromV1Placeholder } from "./recovery";
import { applyCompactionReplacement } from "./replacement";
import { dualCompact, portableCompactOnly } from "./summary";
import type { CodexRecoveryInfo, JsonObject } from "./types";

type SessionBeforeCompactResult = {
  cancel?: boolean;
  compaction?: import("@earendil-works/pi-coding-agent").CompactionResult;
};

export type CodexCompactionRuntime = {
  dualCompact: typeof dualCompact;
  portableCompactOnly: typeof portableCompactOnly;
};

export function createCodexCompactionRuntime(): CodexCompactionRuntime {
  return { dualCompact, portableCompactOnly };
}

export function registerCodexCompactionExtension(
  pi: ExtensionAPI,
  runtime: CodexCompactionRuntime = createCodexCompactionRuntime(),
): void {
  pi.on("session_before_compact", async (event, ctx) => {
    const contextWindow =
      ctx.model && typeof ctx.model.contextWindow === "number" ? ctx.model.contextWindow : undefined;
    const recovery = recoverFromV1Placeholder(event.preparation, event.branchEntries, contextWindow);
    const preparation = recovery?.preparation ?? event.preparation;
    const recoveryInfo = recovery?.recovery;
    const originalPreparation = event.preparation;

    // Recovery path: never fall through to Pi default compact of the placeholder preparation.
    if (recovery) {
      // Cancel ALL truncated legacy/v1 migrations before any portable/dual compact can persist.
      if (recovery.recovery.truncated) {
        return recoveryCancel(
          ctx,
          event.signal,
          "Legacy Codex compaction recovery was truncated; canceling to avoid lossy migration",
        );
      }

      return handleRecoveryCompact({
        pi,
        event,
        ctx,
        preparation,
        originalPreparation,
        recoveryInfo,
        runtime,
      });
    }

    if (!isCodexResponsesModel(ctx.model)) return undefined;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return undefined;

    const accountId = extractChatGptAccountId(auth.apiKey);
    if (!accountId) return undefined;

    try {
      const compaction = await runtime.dualCompact({
        preparation,
        originalPreparation,
        model: ctx.model,
        auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
        customInstructions: event.customInstructions,
        signal: event.signal,
        thinkingLevel: pi.getThinkingLevel(),
        systemPrompt: ctx.getSystemPrompt(),
        tools: activeToolSpecs(pi),
        sessionId: safeSessionId(ctx),
        branchEntries: event.branchEntries,
        recovery: recoveryInfo,
      });

      if (!compaction) return undefined;
      return { compaction };
    } catch (error) {
      if (event.signal.aborted || isAbortError(error)) return undefined;
      if (ctx.hasUI) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(message, "warning");
      }
      return undefined;
    }
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

    const branch = ctx.sessionManager.getBranch();
    const result = applyCompactionReplacement({
      payload: event.payload,
      model: ctx.model,
      branchEntries: branch,
      accountHash,
    });

    return result.mutated ? event.payload : undefined;
  });
}

async function handleRecoveryCompact(options: {
  pi: ExtensionAPI;
  event: SessionBeforeCompactEvent;
  ctx: ExtensionContext;
  preparation: CompactionPreparation;
  originalPreparation: CompactionPreparation;
  recoveryInfo: CodexRecoveryInfo | undefined;
  runtime: CodexCompactionRuntime;
}): Promise<SessionBeforeCompactResult> {
  const { pi, event, ctx, preparation, originalPreparation, recoveryInfo, runtime } = options;

  if (!ctx.model) {
    return recoveryCancel(ctx, event.signal, "Codex compaction recovery requires an active model");
  }

  let auth: Awaited<ReturnType<ExtensionContext["modelRegistry"]["getApiKeyAndHeaders"]>>;
  try {
    auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  } catch (error) {
    if (event.signal.aborted || isAbortError(error)) {
      return recoveryCancel(ctx, event.signal);
    }
    return recoveryCancel(
      ctx,
      event.signal,
      error instanceof Error ? error.message : "Codex compaction recovery auth failed",
    );
  }

  if (!auth.ok) {
    return recoveryCancel(ctx, event.signal, auth.error || "Codex compaction recovery auth unavailable");
  }

  try {
    if (isCodexResponsesModel(ctx.model)) {
      if (!auth.apiKey) {
        return recoveryCancel(ctx, event.signal, "Codex compaction recovery requires API credentials");
      }
      const accountId = extractChatGptAccountId(auth.apiKey);
      if (!accountId) {
        return recoveryCancel(ctx, event.signal, "Codex compaction recovery requires a ChatGPT account id");
      }

      const compaction = await runtime.dualCompact({
        preparation,
        originalPreparation,
        model: ctx.model,
        auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
        customInstructions: event.customInstructions,
        signal: event.signal,
        thinkingLevel: pi.getThinkingLevel(),
        systemPrompt: ctx.getSystemPrompt(),
        tools: activeToolSpecs(pi),
        sessionId: safeSessionId(ctx),
        branchEntries: event.branchEntries,
        recovery: recoveryInfo,
      });

      if (!compaction) {
        return recoveryCancel(
          ctx,
          event.signal,
          event.signal.aborted ? undefined : "Codex compaction recovery summary failed",
        );
      }
      return { compaction };
    }

    const compaction = await runtime.portableCompactOnly({
      preparation,
      model: ctx.model,
      auth: { apiKey: auth.apiKey, headers: auth.headers, env: auth.env },
      customInstructions: event.customInstructions,
      signal: event.signal,
      thinkingLevel: pi.getThinkingLevel(),
      recovery: recoveryInfo,
      branchEntries: event.branchEntries,
    });

    if (!compaction) {
      return recoveryCancel(ctx, event.signal, event.signal.aborted ? undefined : "Compaction recovery summary failed");
    }
    return { compaction };
  } catch (error) {
    if (event.signal.aborted || isAbortError(error)) {
      return recoveryCancel(ctx, event.signal);
    }
    return recoveryCancel(ctx, event.signal, error instanceof Error ? error.message : "Compaction recovery failed");
  }
}

function recoveryCancel(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  signal: AbortSignal,
  message?: string,
): SessionBeforeCompactResult {
  if (!signal.aborted && message && ctx.hasUI) {
    ctx.ui.notify(message, "warning");
  }
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

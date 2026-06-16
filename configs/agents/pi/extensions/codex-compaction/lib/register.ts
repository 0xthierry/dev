import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { fetchCodexCompaction } from "./codex-client";
import { extractChatGptAccountId, isCodexResponsesModel } from "./model";
import { injectCodexCompactionIntoPayload, repairOrphanCodexToolOutputs } from "./payload";
import { messagesToCodexResponseItems } from "./response-items";
import { isInvalidated, latestActiveCodexCompaction } from "./state";
import {
  CODEX_COMPACTION_CUSTOM_INVALIDATION,
  CODEX_COMPACTION_DETAILS_VERSION,
  CODEX_COMPACTION_SENTINEL_PREFIX,
  type CodexCompactionDetails,
  type CodexCompactionInvalidation,
  type JsonObject,
} from "./types";

export function registerCodexCompactionExtension(pi: ExtensionAPI): void {
  const pendingInjected: Array<{ sentinel: string; compactionEntryId?: string }> = [];

  pi.on("session_start", () => {
    pendingInjected.length = 0;
  });

  pi.on("session_shutdown", () => {
    pendingInjected.length = 0;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (!isCodexResponsesModel(ctx.model)) return undefined;

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
    if (!auth.ok || !auth.apiKey) return undefined;

    const accountId = extractChatGptAccountId(auth.apiKey);
    if (!accountId) return undefined;

    const spanMessages = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages];

    const input = codexCompactionInput(
      event.branchEntries,
      spanMessages,
      ctx.model.provider,
      ctx.model.api,
      ctx.model.id,
    );
    if (!input || input.length === 0) return undefined;

    const result = await fetchCodexCompaction({
      model: ctx.model,
      apiKey: auth.apiKey,
      headers: auth.headers,
      accountId,
      systemPrompt: ctx.getSystemPrompt(),
      input,
      tools: activeToolSpecs(pi),
      signal: event.signal,
      thinkingLevel: pi.getThinkingLevel(),
    });

    if (!result.ok) {
      if (ctx.hasUI) ctx.ui.notify(result.reason, "warning");
      return undefined;
    }

    const sentinel = createSentinel();
    const details: CodexCompactionDetails = {
      codexCompaction: {
        version: CODEX_COMPACTION_DETAILS_VERSION,
        sentinel,
        provider: ctx.model.provider,
        api: ctx.model.api,
        modelId: ctx.model.id,
        item: result.item,
      },
    };

    return {
      compaction: {
        summary: codexPlaceholderSummary(sentinel),
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details,
      },
    };
  });

  pi.on("before_provider_request", (event, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    const repaired = repairOrphanCodexToolOutputs(event.payload, branch);
    const result = injectCodexCompactionIntoPayload(event.payload, ctx.model, branch);
    if (result.injected) {
      const active = latestActiveCodexCompaction(branch);
      pendingInjected.push({ sentinel: result.sentinel, compactionEntryId: active?.entry.id });
    }

    return repaired || result.injected ? event.payload : undefined;
  });

  pi.on("after_provider_response", (event) => {
    const injected = pendingInjected.shift();
    if (!injected || (event.status !== 400 && event.status !== 422)) return undefined;

    const invalidation: CodexCompactionInvalidation = {
      sentinel: injected.sentinel,
      compactionEntryId: injected.compactionEntryId,
      status: event.status,
    };
    pi.appendEntry(CODEX_COMPACTION_CUSTOM_INVALIDATION, invalidation);
    return undefined;
  });
}

function codexCompactionInput(
  branchEntries: SessionBeforeCompactEvent["branchEntries"],
  spanMessages: AgentMessage[],
  provider: string,
  api: string,
  modelId: string,
): JsonObject[] | undefined {
  const previousCompaction = [...branchEntries].reverse().find((entry) => entry.type === "compaction");
  const previous = latestActiveCodexCompaction(branchEntries);
  let previousItems: JsonObject[] = [];

  if (previousCompaction) {
    if (
      !previous ||
      previous.details.provider !== provider ||
      previous.details.api !== api ||
      previous.details.modelId !== modelId ||
      isInvalidated(branchEntries, previous.details.sentinel)
    ) {
      return undefined;
    }

    previousItems = [previous.details.item];
  }

  return [...previousItems, ...messagesToCodexResponseItems(spanMessages)];
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

function createSentinel(): string {
  return `${CODEX_COMPACTION_SENTINEL_PREFIX}:${crypto.randomUUID()}`;
}

function codexPlaceholderSummary(sentinel: string): string {
  return [
    "This history segment was compacted with Codex native opaque compaction.",
    `Opaque compaction sentinel: [${sentinel}]`,
  ].join("\n");
}

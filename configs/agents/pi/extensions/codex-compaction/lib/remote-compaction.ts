import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { CompactionResult, SessionEntry } from "@earendil-works/pi-coding-agent";
import { createBinding, hashAccountId, isCompatibleV2Binding } from "./binding";
import { fetchCodexCompaction } from "./codex-client";
import { compactionFileDetails, mergeLatestCompactionFileOps } from "./file-ops";
import { extractChatGptAccountId } from "./model";
import type { CompactionPreparation } from "./recovery";
import { messagesToCodexResponseItems } from "./response-items";
import { isArtifactUnusable, isExactLegacyPlaceholderSummary, isValidArtifact, latestCompaction } from "./state";
import {
  CODEX_COMPACTION_DETAILS_VERSION,
  CODEX_OPAQUE_SUMMARY_PLACEHOLDER,
  type CodexCompactionV2,
  type CodexModel,
  type CodexRecoveryInfo,
  type CompactionAuth,
  type CompactionEntryDetails,
  type JsonObject,
} from "./types";
import { buildUserPrefix } from "./user-prefix";

export type RemoteCompactRuntime = {
  fetchCodexCompaction: typeof fetchCodexCompaction;
};

export function createRemoteCompactRuntime(): RemoteCompactRuntime {
  return { fetchCodexCompaction };
}

export type RemoteCompactOptions = {
  preparation: CompactionPreparation;
  /** Original preparation before legacy recovery prepend, avoiding duplicate remote input. */
  originalPreparation?: CompactionPreparation;
  model: CodexModel;
  auth: CompactionAuth;
  signal?: AbortSignal;
  thinkingLevel: string;
  systemPrompt: string;
  tools?: JsonObject[];
  sessionId?: string;
  branchEntries: SessionEntry[];
  recovery?: CodexRecoveryInfo;
  runtime?: RemoteCompactRuntime;
};

/** Performs exactly one Codex compaction-trigger request and never calls Pi's portable compact(). */
export async function remoteCompact(options: RemoteCompactOptions): Promise<CompactionResult | undefined> {
  const runtime = options.runtime ?? createRemoteCompactRuntime();
  const accountId = options.auth.apiKey ? extractChatGptAccountId(options.auth.apiKey) : undefined;
  if (!accountId || !options.auth.apiKey || options.signal?.aborted) return undefined;

  const preparation = mergeLatestCompactionFileOps(options.preparation, options.branchEntries);
  const input = buildRemoteCompactionInput({
    preparation,
    originalPreparation: options.originalPreparation ?? preparation,
    model: options.model,
    accountId,
    branchEntries: options.branchEntries,
    recovery: options.recovery,
  });
  if (!input) return undefined;

  const result = await runtime.fetchCodexCompaction({
    model: options.model,
    apiKey: options.auth.apiKey,
    headers: options.auth.headers,
    accountId,
    systemPrompt: options.systemPrompt,
    input,
    tools: options.tools,
    signal: options.signal,
    thinkingLevel: options.thinkingLevel,
    sessionId: options.sessionId,
  });

  if (!result.ok || options.signal?.aborted) return undefined;

  return buildRemoteCompactionResult({
    remoteResult: result,
    preparation,
    model: options.model,
    accountId,
    branchEntries: options.branchEntries,
    recovery: options.recovery,
  });
}

export function buildRemoteCompactionResult(options: {
  remoteResult: Extract<Awaited<ReturnType<typeof fetchCodexCompaction>>, { ok: true }>;
  preparation: CompactionPreparation;
  model: CodexModel;
  accountId: string;
  branchEntries: SessionEntry[];
  recovery?: CodexRecoveryInfo;
}): CompactionResult {
  const previousUserPrefix = previousV2UserPrefix(options.branchEntries);
  const userPrefix = buildUserPrefix({
    previousUserPrefix,
    discardedMessages: discardedSpanMessages(options.preparation),
    keepRecentTokens: options.preparation.settings.keepRecentTokens,
  });

  const codexCompaction: CodexCompactionV2 = {
    version: CODEX_COMPACTION_DETAILS_VERSION,
    binding: createBinding(options.model, options.accountId),
    userPrefix,
    artifact: [options.remoteResult.item],
    firstKeptEntryId: options.preparation.firstKeptEntryId,
    tokensBefore: options.preparation.tokensBefore,
    responseId: options.remoteResult.responseId,
    remoteUsage: options.remoteResult.usage,
    recovery: options.recovery,
  };

  const details: CompactionEntryDetails = {
    ...compactionFileDetails(options.preparation),
    codexCompaction,
  };

  return {
    summary: CODEX_OPAQUE_SUMMARY_PLACEHOLDER,
    firstKeptEntryId: options.preparation.firstKeptEntryId,
    tokensBefore: options.preparation.tokensBefore,
    usage: options.remoteResult.usage,
    details,
  };
}

export function buildRemoteCompactionInput(options: {
  preparation: CompactionPreparation;
  originalPreparation: CompactionPreparation;
  model: CodexModel;
  accountId: string;
  branchEntries: SessionEntry[];
  recovery?: CodexRecoveryInfo;
}): JsonObject[] | undefined {
  const prefix = buildNextRemotePrefix(options);

  // A compatible v1 artifact already represents recovered history. Append only the original
  // current span, not raw history prepended for migration safety.
  const useOriginalSpan =
    Boolean(options.recovery?.attempted) && prefix.length === 1 && prefix[0]?.type === "compaction";
  const spanPreparation = useOriginalSpan ? options.originalPreparation : options.preparation;
  const span = messagesToCodexResponseItems(discardedSpanMessages(spanPreparation));

  if (prefix.length === 0 && span.length === 0) return undefined;
  return [...prefix, ...span];
}

export function buildNextRemotePrefix(options: {
  preparation: CompactionPreparation;
  model: CodexModel;
  accountId: string;
  branchEntries: SessionEntry[];
}): JsonObject[] {
  const latest = latestCompaction(options.branchEntries);
  if (latest.kind === "none") return [];

  if (latest.kind === "v1") {
    const compatible =
      !isArtifactUnusable(options.branchEntries) &&
      latest.record.provider === options.model.provider &&
      latest.record.api === options.model.api &&
      latest.record.modelId === options.model.id;
    return compatible ? [latest.record.item] : safePreviousSummaryUserItem(options.preparation.previousSummary);
  }

  if (latest.kind === "v2") {
    const compatible =
      !isArtifactUnusable(options.branchEntries) &&
      isCompatibleV2Binding(latest.record, options.model, hashAccountId(options.accountId)) &&
      isValidArtifact(latest.record.artifact);

    if (compatible) return [...latest.record.userPrefix, ...latest.record.artifact];

    // New remote-only records have no semantic summary to chain. Their validated user prefix
    // is the only safe portable residue. Older v2 records may still carry a real summary.
    return [...latest.record.userPrefix, ...safePreviousSummaryUserItem(options.preparation.previousSummary)];
  }

  // An ordinary Pi compaction is semantic and may safely seed the next remote compaction.
  return safePreviousSummaryUserItem(options.preparation.previousSummary);
}

function previousV2UserPrefix(branchEntries: SessionEntry[]): JsonObject[] | undefined {
  const latest = latestCompaction(branchEntries);
  return latest.kind === "v2" ? latest.record.userPrefix : undefined;
}

function safePreviousSummaryUserItem(previousSummary: string | undefined): JsonObject[] {
  if (!previousSummary || previousSummary.trim().length === 0) return [];
  if (previousSummary.trim() === CODEX_OPAQUE_SUMMARY_PLACEHOLDER) return [];
  if (isExactLegacyPlaceholderSummary(previousSummary)) return [];
  return [{ role: "user", content: `Previous conversation summary:\n${previousSummary}` }];
}

function discardedSpanMessages(preparation: CompactionPreparation): AgentMessage[] {
  return [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
}

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ProviderHeaders, Usage } from "@earendil-works/pi-ai";
import { type CompactionResult, compact, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { createBinding, hashAccountId, isCompatibleV2Binding } from "./binding";
import { fetchCodexCompaction } from "./codex-client";
import { mergeLatestCompactionFileOps } from "./file-ops";
import { extractChatGptAccountId, isCodexResponsesModel } from "./model";
import type { CompactionPreparation } from "./recovery";
import { messagesToCodexResponseItems } from "./response-items";
import { isArtifactUnusable, isValidArtifact, latestCompaction } from "./state";
import {
  CODEX_COMPACTION_DETAILS_VERSION,
  type CodexCompactionFetchResult,
  type CodexCompactionV2,
  type CodexModel,
  type CodexRecoveryInfo,
  type CompactionEntryDetails,
  type JsonObject,
} from "./types";
import { buildUserPrefix } from "./user-prefix";

export type CompactAuth = {
  apiKey?: string;
  headers?: ProviderHeaders;
  env?: Record<string, string>;
};

export type DualCompactRuntime = {
  compact: typeof compact;
  fetchCodexCompaction: typeof fetchCodexCompaction;
};

export function createDualCompactRuntime(): DualCompactRuntime {
  return { compact, fetchCodexCompaction };
}

export type DualCompactOptions = {
  preparation: CompactionPreparation;
  /** Original preparation before recovery prepend — used to avoid remote span duplication. */
  originalPreparation?: CompactionPreparation;
  model: CodexModel;
  auth: CompactAuth;
  customInstructions?: string;
  signal?: AbortSignal;
  thinkingLevel: string;
  systemPrompt: string;
  tools?: JsonObject[];
  sessionId?: string;
  branchEntries: SessionEntry[];
  recovery?: CodexRecoveryInfo;
  runtime?: DualCompactRuntime;
};

export async function dualCompact(options: DualCompactOptions): Promise<CompactionResult | undefined> {
  const runtime = options.runtime ?? createDualCompactRuntime();
  const accountId = options.auth.apiKey ? extractChatGptAccountId(options.auth.apiKey) : undefined;
  if (!accountId || !options.auth.apiKey) return undefined;

  const preparation = mergeLatestCompactionFileOps(options.preparation, options.branchEntries);

  const remoteInput = buildRemoteCompactionInput({
    preparation,
    originalPreparation: options.originalPreparation ?? preparation,
    model: options.model,
    accountId,
    branchEntries: options.branchEntries,
    recovery: options.recovery,
  });

  const [summaryOutcome, remoteOutcome] = await Promise.allSettled([
    runtime.compact(
      preparation,
      options.model,
      options.auth.apiKey,
      // Pi 0.84 preserves null header-deletion markers at runtime, but compact's
      // compatibility declaration still exposes the older string-only shape.
      options.auth.headers as Record<string, string> | undefined,
      options.customInstructions,
      options.signal,
      options.thinkingLevel as never,
      undefined,
      options.auth.env,
    ),
    remoteInput
      ? runtime.fetchCodexCompaction({
          model: options.model,
          apiKey: options.auth.apiKey,
          headers: options.auth.headers,
          accountId,
          systemPrompt: options.systemPrompt,
          input: remoteInput,
          tools: options.tools,
          signal: options.signal,
          thinkingLevel: options.thinkingLevel,
          sessionId: options.sessionId,
        })
      : Promise.resolve({ ok: false as const, reason: "no-remote-input" }),
  ]);

  if (options.signal?.aborted) return undefined;

  if (summaryOutcome.status !== "fulfilled") {
    return undefined;
  }

  const summaryResult = summaryOutcome.value;
  const remoteResult: CodexCompactionFetchResult =
    remoteOutcome.status === "fulfilled" ? remoteOutcome.value : { ok: false, reason: "remote-rejected" };

  return mergeDualCompactionResult({
    summaryResult,
    remoteResult,
    preparation,
    model: options.model,
    accountId,
    branchEntries: options.branchEntries,
    recovery: options.recovery,
    aborted: options.signal?.aborted === true,
  });
}

export function mergeDualCompactionResult(options: {
  summaryResult: CompactionResult;
  remoteResult: CodexCompactionFetchResult;
  preparation: CompactionPreparation;
  model: CodexModel;
  accountId: string;
  branchEntries: SessionEntry[];
  recovery?: CodexRecoveryInfo;
  aborted?: boolean;
}): CompactionResult | undefined {
  if (options.aborted) return undefined;

  if (!options.remoteResult.ok) {
    if (options.remoteResult.aborted) return undefined;
    return buildSummaryOnlyResult(options.summaryResult, options.recovery, options.remoteResult.usage);
  }

  const previousUserPrefix = previousV2UserPrefix(options.branchEntries);
  const userPrefix = buildUserPrefix({
    previousUserPrefix,
    discardedMessages: discardedSpanMessages(options.preparation),
    keepRecentTokens: options.preparation.settings.keepRecentTokens,
  });

  const binding = createBinding(options.model, options.accountId);
  const codexCompaction: CodexCompactionV2 = {
    version: CODEX_COMPACTION_DETAILS_VERSION,
    binding,
    userPrefix,
    artifact: [options.remoteResult.item],
    firstKeptEntryId: options.summaryResult.firstKeptEntryId,
    tokensBefore: options.summaryResult.tokensBefore,
    responseId: options.remoteResult.responseId,
    remoteUsage: options.remoteResult.usage,
    recovery: options.recovery,
  };

  const baseDetails = (options.summaryResult.details ?? {}) as CompactionEntryDetails;
  const details: CompactionEntryDetails = {
    readFiles: baseDetails.readFiles,
    modifiedFiles: baseDetails.modifiedFiles,
    codexCompaction,
  };

  return {
    summary: options.summaryResult.summary,
    firstKeptEntryId: options.summaryResult.firstKeptEntryId,
    tokensBefore: options.summaryResult.tokensBefore,
    usage: combineUsage(options.summaryResult.usage, options.remoteResult.usage),
    details,
  };
}

export async function portableCompactOnly(options: {
  preparation: CompactionPreparation;
  model: NonNullable<Parameters<typeof compact>[1]>;
  auth: CompactAuth;
  customInstructions?: string;
  signal?: AbortSignal;
  thinkingLevel: string;
  recovery?: CodexRecoveryInfo;
  branchEntries?: SessionEntry[];
  compactFn?: typeof compact;
}): Promise<CompactionResult | undefined> {
  const compactFn = options.compactFn ?? compact;
  const preparation = options.branchEntries
    ? mergeLatestCompactionFileOps(options.preparation, options.branchEntries)
    : options.preparation;

  try {
    const summaryResult = await compactFn(
      preparation,
      options.model,
      options.auth.apiKey,
      // Preserve ProviderHeaders null markers for the underlying pi-ai stream.
      options.auth.headers as Record<string, string> | undefined,
      options.customInstructions,
      options.signal,
      options.thinkingLevel as never,
      undefined,
      options.auth.env,
    );
    if (options.signal?.aborted) return undefined;
    return buildSummaryOnlyResult(summaryResult, options.recovery);
  } catch {
    if (options.signal?.aborted) return undefined;
    return undefined;
  }
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

  // When recovery is active and a compatible v1 artifact is chained, use the ORIGINAL
  // discarded span so recovered raw context is not duplicated after the old artifact.
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
    const unusable = isArtifactUnusable(options.branchEntries);
    const compatible =
      !unusable &&
      latest.record.provider === options.model.provider &&
      latest.record.api === options.model.api &&
      latest.record.modelId === options.model.id;
    if (compatible) return [latest.record.item];
    return previousSummaryUserItem(options.preparation.previousSummary);
  }

  if (latest.kind === "v2") {
    const unusable = isArtifactUnusable(options.branchEntries);
    const compatible =
      !unusable &&
      isCompatibleV2Binding(latest.record, options.model, hashAccountId(options.accountId)) &&
      isValidArtifact(latest.record.artifact);

    if (compatible) {
      return [...latest.record.userPrefix, ...latest.record.artifact];
    }

    return [...latest.record.userPrefix, ...previousSummaryUserItem(options.preparation.previousSummary)];
  }

  // Ordinary Pi compaction: never chain older Codex artifacts.
  return previousSummaryUserItem(options.preparation.previousSummary);
}

function previousV2UserPrefix(branchEntries: SessionEntry[]): JsonObject[] | undefined {
  const latest = latestCompaction(branchEntries);
  if (latest.kind !== "v2") return undefined;
  return latest.record.userPrefix;
}

function previousSummaryUserItem(previousSummary: string | undefined): JsonObject[] {
  if (!previousSummary || previousSummary.trim().length === 0) return [];
  return [
    {
      role: "user",
      content: `Previous conversation summary:\n${previousSummary}`,
    },
  ];
}

function discardedSpanMessages(preparation: CompactionPreparation): AgentMessage[] {
  return [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
}

function buildSummaryOnlyResult(
  summaryResult: CompactionResult,
  recovery?: CodexRecoveryInfo,
  remoteUsage?: Usage,
): CompactionResult {
  const baseDetails = (summaryResult.details ?? {}) as CompactionEntryDetails;
  const details: CompactionEntryDetails = {
    readFiles: baseDetails.readFiles,
    modifiedFiles: baseDetails.modifiedFiles,
    ...(recovery ? { recovery } : {}),
  };

  return {
    ...summaryResult,
    usage: combineUsage(summaryResult.usage, remoteUsage),
    details,
  };
}

export function combineUsage(left?: Usage, right?: Usage): Usage | undefined {
  if (!left) return right;
  if (!right) return left;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    ...(left.cacheWrite1h !== undefined || right.cacheWrite1h !== undefined
      ? { cacheWrite1h: (left.cacheWrite1h ?? 0) + (right.cacheWrite1h ?? 0) }
      : {}),
    ...(left.reasoning !== undefined || right.reasoning !== undefined
      ? { reasoning: (left.reasoning ?? 0) + (right.reasoning ?? 0) }
      : {}),
    totalTokens: left.totalTokens + right.totalTokens,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

export function assertCodexModel(model: unknown): model is CodexModel {
  return isCodexResponsesModel(model as never);
}

import {
  estimateTokens,
  prepareBranchEntries,
  type SessionBeforeCompactEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { isExactLegacyPlaceholderSummary, latestCompaction } from "./state";
import { type CodexRecoveryInfo, RECOVERY_PROMPT_MARGIN_TOKENS } from "./types";

export type CompactionPreparation = SessionBeforeCompactEvent["preparation"];

export type RecoveryAdjustment = {
  preparation: CompactionPreparation;
  recovery: CodexRecoveryInfo;
  /** Messages prepended for portable summary; stripped from remote span when chaining a v1 artifact. */
  recoveredMessageCount: number;
};

/**
 * Model-agnostic v1/legacy-placeholder recovery.
 * A successfully parsed latest v2 is never recovery, even if its summary text mentions the sentinel.
 */
export function recoverFromV1Placeholder(
  preparation: CompactionPreparation,
  branchEntries: SessionEntry[],
  contextWindow?: number,
): RecoveryAdjustment | undefined {
  const latest = latestCompaction(branchEntries);
  if (latest.kind === "none") return undefined;

  // Parsed v2 is never legacy recovery.
  if (latest.kind === "v2") return undefined;

  const needsRecovery =
    latest.kind === "v1" || (latest.kind === "ordinary" && isExactLegacyPlaceholderSummary(latest.entry.summary));

  if (!needsRecovery) return undefined;

  const firstKeptEntryId = latest.entry.firstKeptEntryId;
  const boundaryIndex = branchEntries.findIndex((entry) => entry.id === firstKeptEntryId);
  // Missing firstKept: only entries before the latest compaction (never whole branch / post-compaction tail).
  const compactionIndex = branchEntries.findIndex((entry) => entry.id === latest.entry.id);
  const sliceEnd = boundaryIndex === -1 ? (compactionIndex === -1 ? 0 : compactionIndex) : boundaryIndex;
  const preBoundary = branchEntries.slice(0, sliceEnd).filter((entry) => entry.type !== "compaction");

  const budget = computeRecoveryBudget(preparation, contextWindow);
  const full = prepareBranchEntries(preBoundary, 0);
  // prepareBranchEntries treats 0 as unlimited — clamp empty selection ourselves.
  const selected =
    budget <= 0
      ? { messages: [] as typeof full.messages, fileOps: full.fileOps, totalTokens: 0 }
      : prepareBranchEntries(preBoundary, budget);
  const truncated = full.totalTokens > selected.totalTokens || full.messages.length > selected.messages.length;

  const recoveredMessages = selected.messages;
  const messagesToSummarize = [...recoveredMessages, ...preparation.messagesToSummarize];

  return {
    preparation: {
      ...preparation,
      previousSummary: undefined,
      messagesToSummarize,
      // Use FULL recovered fileOps so truncation does not erase cumulative file metadata.
      fileOps: {
        read: new Set([...preparation.fileOps.read, ...full.fileOps.read]),
        written: new Set([...preparation.fileOps.written, ...full.fileOps.written]),
        edited: new Set([...preparation.fileOps.edited, ...full.fileOps.edited]),
      },
    },
    recovery: {
      attempted: true,
      truncated,
      recoveredMessages: recoveredMessages.length,
    },
    recoveredMessageCount: recoveredMessages.length,
  };
}

export function computeRecoveryBudget(preparation: CompactionPreparation, contextWindow?: number): number {
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return 0;
  }

  let existing = 0;
  for (const message of preparation.messagesToSummarize) existing += estimateTokens(message);
  // Conservatively count turn-prefix against the same headroom.
  for (const message of preparation.turnPrefixMessages) existing += estimateTokens(message);

  const reserved = preparation.settings.reserveTokens + RECOVERY_PROMPT_MARGIN_TOKENS + existing;
  return Math.max(0, contextWindow - reserved);
}

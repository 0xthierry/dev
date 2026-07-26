import type { CompactionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  CODEX_COMPACTION_CUSTOM_INVALIDATION,
  CODEX_COMPACTION_DETAILS_VERSION,
  CODEX_COMPACTION_DETAILS_VERSION_V1,
  CODEX_COMPACTION_SENTINEL_PREFIX,
  type CodexCompactionInvalidation,
  type CodexCompactionItem,
  type CodexCompactionRecord,
  type CodexCompactionV1,
  type CodexCompactionV2,
  type CompactionEntryDetails,
  type JsonObject,
  SEAM_STRIKE_THRESHOLD,
} from "./types";
import { isUserPrefixItem } from "./user-prefix";

export type LatestCompaction =
  | {
      kind: "v2";
      entry: CompactionEntry;
      details: CompactionEntryDetails;
      record: CodexCompactionV2;
    }
  | {
      kind: "v1";
      entry: CompactionEntry;
      details: CompactionEntryDetails;
      record: CodexCompactionV1;
    }
  | {
      kind: "ordinary";
      entry: CompactionEntry;
      details: CompactionEntryDetails;
    }
  | { kind: "none" };

export function latestCompaction(entries: SessionEntry[]): LatestCompaction {
  const latest = [...entries].reverse().find((entry): entry is CompactionEntry => entry.type === "compaction");
  if (!latest) return { kind: "none" };

  const details = (latest.details ?? {}) as CompactionEntryDetails;
  const record = parseCodexCompactionRecord(details.codexCompaction);
  if (record?.version === CODEX_COMPACTION_DETAILS_VERSION) {
    return { kind: "v2", entry: latest, details, record };
  }
  if (record?.version === CODEX_COMPACTION_DETAILS_VERSION_V1) {
    return { kind: "v1", entry: latest, details, record };
  }
  return { kind: "ordinary", entry: latest, details };
}

export function parseCodexCompactionRecord(value: unknown): CodexCompactionRecord | undefined {
  if (!isJsonObject(value)) return undefined;

  if (value.version === CODEX_COMPACTION_DETAILS_VERSION) {
    return parseV2(value);
  }

  if (value.version === CODEX_COMPACTION_DETAILS_VERSION_V1) {
    return parseV1(value);
  }

  return undefined;
}

/**
 * Exact trimmed two-line legacy placeholder only:
 *   This history segment was compacted with Codex native opaque compaction.
 *   Opaque compaction sentinel: [pi-codex-compaction:<nonempty id>]
 * Anchored; quoted/wrapped templates do not match. Parsed v1 recovers independently.
 */
export function isExactLegacyPlaceholderSummary(summary: string | undefined): boolean {
  if (typeof summary !== "string") return false;
  const trimmed = summary.trim();
  return /^This history segment was compacted with Codex native opaque compaction\.\r?\nOpaque compaction sentinel: \[pi-codex-compaction:[^\]\s]+\]$/.test(
    trimmed,
  );
}

export function extractV1Sentinel(summary: string | undefined, record?: CodexCompactionV1): string | undefined {
  if (record?.sentinel) return record.sentinel;
  if (typeof summary !== "string") return undefined;
  const match = summary.match(new RegExp(`${CODEX_COMPACTION_SENTINEL_PREFIX}:[\\w-]+`));
  return match?.[0];
}

/** Artifact is unusable for injection/chaining after rejection, custom invalidation, or seam strikes. */
export function isArtifactUnusable(entries: SessionEntry[]): boolean {
  const latest = latestCompaction(entries);
  if (latest.kind === "none") return true;

  const after = entriesAfter(entries, latest.entry.id);
  if (after.some(isArtifactRejectionMessage)) return true;
  if (hasCustomInvalidation(entries, latest)) return true;
  if (countSeamStrikes(after) >= SEAM_STRIKE_THRESHOLD) return true;
  return false;
}

export function isArtifactDisabled(entries: SessionEntry[]): boolean {
  return isArtifactUnusable(entries);
}

export function isSeamRepairDisabled(entries: SessionEntry[]): boolean {
  const latest = latestCompaction(entries);
  if (latest.kind === "none") return true;

  const after = entriesAfter(entries, latest.entry.id);
  return countSeamStrikes(after) >= SEAM_STRIKE_THRESHOLD;
}

export function countSeamStrikes(entries: SessionEntry[]): number {
  return entries.filter(isSeamErrorMessage).length;
}

export function isValidArtifact(artifact: unknown): artifact is CodexCompactionItem[] {
  return Array.isArray(artifact) && artifact.length === 1 && isCodexCompactionItem(artifact[0]);
}

export function isCodexCompactionItem(value: unknown): value is CodexCompactionItem {
  return (
    isJsonObject(value) &&
    value.type === "compaction" &&
    typeof value.encrypted_content === "string" &&
    value.encrypted_content.length > 0 &&
    (value.id === undefined || typeof value.id === "string")
  );
}

function parseV2(value: JsonObject): CodexCompactionV2 | undefined {
  const binding = value.binding;
  if (!isJsonObject(binding)) return undefined;
  if (typeof binding.provider !== "string") return undefined;
  if (typeof binding.api !== "string") return undefined;
  if (typeof binding.modelId !== "string") return undefined;
  if (typeof binding.endpoint !== "string") return undefined;
  if (typeof binding.accountHash !== "string") return undefined;
  if (!Array.isArray(value.userPrefix)) return undefined;
  if (typeof value.firstKeptEntryId !== "string") return undefined;
  if (typeof value.tokensBefore !== "number") return undefined;

  // Keep only validated prefix items; never inject arbitrary JSON.
  const userPrefix = value.userPrefix.filter(isUserPrefixItem);

  // Invalid artifact normalizes to [] so prefix-only degradation remains reachable.
  const artifact = isValidArtifact(value.artifact) ? value.artifact : [];

  return {
    version: CODEX_COMPACTION_DETAILS_VERSION,
    binding: {
      provider: binding.provider,
      api: binding.api,
      modelId: binding.modelId,
      endpoint: binding.endpoint,
      accountHash: binding.accountHash,
    },
    userPrefix,
    artifact,
    firstKeptEntryId: value.firstKeptEntryId,
    tokensBefore: value.tokensBefore,
    responseId: typeof value.responseId === "string" ? value.responseId : undefined,
    remoteUsage: isJsonObject(value.remoteUsage)
      ? (value.remoteUsage as unknown as NonNullable<CodexCompactionV2["remoteUsage"]>)
      : undefined,
    recovery: isJsonObject(value.recovery)
      ? {
          attempted: value.recovery.attempted === true,
          truncated: value.recovery.truncated === true,
          recoveredMessages:
            typeof value.recovery.recoveredMessages === "number" ? value.recovery.recoveredMessages : 0,
        }
      : undefined,
  };
}

function parseV1(value: JsonObject): CodexCompactionV1 | undefined {
  if (typeof value.sentinel !== "string") return undefined;
  if (typeof value.provider !== "string") return undefined;
  if (typeof value.api !== "string") return undefined;
  if (typeof value.modelId !== "string") return undefined;
  if (!isCodexCompactionItem(value.item)) return undefined;

  return {
    version: CODEX_COMPACTION_DETAILS_VERSION_V1,
    sentinel: value.sentinel,
    provider: value.provider,
    api: value.api,
    modelId: value.modelId,
    item: value.item,
  };
}

function hasCustomInvalidation(entries: SessionEntry[], latest: Exclude<LatestCompaction, { kind: "none" }>): boolean {
  const after = entriesAfter(entries, latest.entry.id);
  const sentinel = latest.kind === "v1" ? latest.record.sentinel : extractV1Sentinel(latest.entry.summary);

  return after.some((entry) => {
    if (entry.type !== "custom" || entry.customType !== CODEX_COMPACTION_CUSTOM_INVALIDATION) return false;
    const data = entry.data as Partial<CodexCompactionInvalidation> | undefined;
    if (!data) return false;

    if (typeof data.compactionEntryId === "string" && data.compactionEntryId === latest.entry.id) return true;
    if (typeof data.sentinel === "string" && sentinel && data.sentinel === sentinel) return true;
    return false;
  });
}

function entriesAfter(entries: SessionEntry[], entryId: string): SessionEntry[] {
  const index = entries.findIndex((entry) => entry.id === entryId);
  if (index === -1) return [];
  return entries.slice(index + 1);
}

function isArtifactRejectionMessage(entry: SessionEntry): boolean {
  const errorMessage = assistantErrorMessage(entry);
  if (!errorMessage) return false;
  return isArtifactRejectionError(errorMessage);
}

function isSeamErrorMessage(entry: SessionEntry): boolean {
  const errorMessage = assistantErrorMessage(entry);
  if (!errorMessage) return false;
  return isSeamError(errorMessage);
}

function assistantErrorMessage(entry: SessionEntry): string | undefined {
  if (entry.type !== "message") return undefined;

  const message = entry.message as
    | { role?: unknown; api?: unknown; stopReason?: unknown; errorMessage?: unknown }
    | undefined;
  if (message?.role !== "assistant" || message.api !== "openai-codex-responses" || message.stopReason !== "error") {
    return undefined;
  }
  return typeof message.errorMessage === "string" ? message.errorMessage : undefined;
}

/** Centralized conservative signatures for artifact rejection. */
export function isArtifactRejectionError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();

  return (
    (lower.includes("compaction") &&
      (lower.includes("invalid") || lower.includes("unknown") || lower.includes("reject"))) ||
    lower.includes("encrypted_content") ||
    lower.includes("failed to decrypt") ||
    lower.includes("unable to decrypt") ||
    lower.includes("unknown item") ||
    lower.includes("unsupported item")
  );
}

/** Centralized conservative signatures for tool-call seam errors. */
export function isSeamError(errorMessage: string): boolean {
  return (
    errorMessage.includes("No tool call found for function call output") ||
    errorMessage.toLowerCase().includes("no tool call found for function call output")
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

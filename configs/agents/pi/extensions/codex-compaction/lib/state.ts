import type { CompactionEntry, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  CODEX_COMPACTION_CUSTOM_INVALIDATION,
  CODEX_COMPACTION_DETAILS_VERSION,
  type CodexCompactionDetails,
  type CodexCompactionInvalidation,
} from "./types";

export type ActiveCodexCompaction = {
  entry: CompactionEntry<CodexCompactionDetails>;
  details: CodexCompactionDetails["codexCompaction"];
};

export function latestActiveCodexCompaction(entries: SessionEntry[]): ActiveCodexCompaction | undefined {
  const latest = [...entries].reverse().find(isCodexCompactionEntry);
  if (!latest) return undefined;

  const details = latest.details?.codexCompaction;
  if (!details) return undefined;

  return { entry: latest, details };
}

export function isInvalidated(entries: SessionEntry[], sentinel: string): boolean {
  if (hasExplicitInvalidation(entries, sentinel)) return true;

  const compactionIndex = entries.findIndex(
    (entry) => isCodexCompactionEntry(entry) && entry.details?.codexCompaction.sentinel === sentinel,
  );
  if (compactionIndex === -1) return false;

  return entries.slice(compactionIndex + 1).some(isCodexCompactionRejectedMessage);
}

function hasExplicitInvalidation(entries: SessionEntry[], sentinel: string): boolean {
  return entries.some((entry) => {
    if (entry.type !== "custom" || entry.customType !== CODEX_COMPACTION_CUSTOM_INVALIDATION) return false;
    const data = entry.data as Partial<CodexCompactionInvalidation> | undefined;
    return data?.sentinel === sentinel;
  });
}

function isCodexCompactionRejectedMessage(entry: SessionEntry): boolean {
  if (entry.type !== "message") return false;

  const message = entry.message as
    | { role?: unknown; api?: unknown; stopReason?: unknown; errorMessage?: unknown }
    | undefined;
  if (message?.role !== "assistant" || message.api !== "openai-codex-responses" || message.stopReason !== "error") {
    return false;
  }

  return isCompactionProtocolError(message.errorMessage);
}

function isCompactionProtocolError(errorMessage: unknown): boolean {
  if (typeof errorMessage !== "string") return false;

  return (
    errorMessage.includes("invalid_request_error") &&
    errorMessage.includes("No tool call found for function call output")
  );
}

export function isCodexCompactionEntry(entry: SessionEntry): entry is CompactionEntry<CodexCompactionDetails> {
  if (entry.type !== "compaction") return false;

  const details = entry.details as Partial<CodexCompactionDetails> | undefined;
  const codexCompaction = details?.codexCompaction;

  return (
    codexCompaction?.version === CODEX_COMPACTION_DETAILS_VERSION &&
    typeof codexCompaction.sentinel === "string" &&
    typeof codexCompaction.provider === "string" &&
    typeof codexCompaction.api === "string" &&
    typeof codexCompaction.modelId === "string" &&
    codexCompaction.item?.type === "compaction" &&
    typeof codexCompaction.item.encrypted_content === "string"
  );
}

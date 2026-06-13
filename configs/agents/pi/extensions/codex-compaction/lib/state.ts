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
  return entries.some((entry) => {
    if (entry.type !== "custom" || entry.customType !== CODEX_COMPACTION_CUSTOM_INVALIDATION) return false;
    const data = entry.data as Partial<CodexCompactionInvalidation> | undefined;
    return data?.sentinel === sentinel;
  });
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

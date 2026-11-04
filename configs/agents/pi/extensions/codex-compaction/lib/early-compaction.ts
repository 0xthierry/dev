import { buildSessionProjection, findCutPoint, type SessionEntry } from "@earendil-works/pi-coding-agent";

/**
 * Provider usage can stay high even when Pi has no discardable conversation span.
 * Check the visible retained history before calling ctx.compact(), which aborts the
 * active run before Pi discovers an empty compaction. Prompt state and already
 * compacted history are not new material to summarize.
 */
export function hasCompactableHistory(branch: SessionEntry[], keepRecentTokens: number): boolean {
  if (branch.at(-1)?.type === "compaction") return false;

  const entries: SessionEntry[] = [];
  for (const { sourceEntry, messages } of buildSessionProjection(branch).entries) {
    if (sourceEntry.type === "compaction") continue;
    for (const message of messages) {
      if (message.role === "system") continue;
      entries.push({
        type: "message",
        id: sourceEntry.id,
        parentId: sourceEntry.parentId,
        timestamp: sourceEntry.timestamp,
        message,
      });
    }
  }
  if (entries.length === 0) return false;

  // Use Pi's public cut selection to keep tool-call/result boundaries intact.
  // Recovery-only omission suffixes remain owned by Pi's overflow path.
  const cut = findCutPoint(entries, 0, entries.length, keepRecentTokens);
  return cut.firstKeptEntryIndex > 0;
}

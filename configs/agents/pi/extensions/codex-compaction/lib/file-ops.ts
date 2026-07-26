import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { CompactionPreparation } from "./recovery";
import { latestCompaction } from "./state";
import type { CompactionEntryDetails } from "./types";

/**
 * Pi ignores fromHook compaction details on the next prepare. Merge the latest
 * compaction entry's readFiles/modifiedFiles into preparation.fileOps so repeated
 * extension compactions keep cumulative file metadata. Modified wins over read.
 */
export function mergeLatestCompactionFileOps(
  preparation: CompactionPreparation,
  branchEntries: SessionEntry[],
): CompactionPreparation {
  const latest = latestCompaction(branchEntries);
  if (latest.kind === "none") return preparation;

  const details = latest.details as CompactionEntryDetails;
  const readFiles = Array.isArray(details.readFiles) ? details.readFiles : [];
  const modifiedFiles = Array.isArray(details.modifiedFiles) ? details.modifiedFiles : [];
  if (readFiles.length === 0 && modifiedFiles.length === 0) return preparation;

  const read = new Set(preparation.fileOps.read);
  const written = new Set(preparation.fileOps.written);
  const edited = new Set(preparation.fileOps.edited);

  for (const path of readFiles) read.add(path);
  for (const path of modifiedFiles) {
    edited.add(path);
    written.add(path);
    read.delete(path);
  }

  // Ensure modified files are not left only in read from prior sets.
  for (const path of edited) read.delete(path);
  for (const path of written) read.delete(path);

  return {
    ...preparation,
    fileOps: { read, written, edited },
  };
}

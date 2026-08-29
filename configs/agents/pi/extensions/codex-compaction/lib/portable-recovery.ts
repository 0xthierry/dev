import { type CompactionResult, compact, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { mergeLatestCompactionFileOps } from "./file-ops";
import type { CompactionPreparation } from "./recovery";
import type { CodexRecoveryInfo, CompactionAuth, CompactionEntryDetails } from "./types";

/** Migration fallback for legacy placeholders resumed on a non-Codex model. */
export async function portableCompactOnly(options: {
  preparation: CompactionPreparation;
  model: NonNullable<Parameters<typeof compact>[1]>;
  auth: CompactionAuth;
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
      options.auth.headers as Record<string, string> | undefined,
      options.customInstructions,
      options.signal,
      options.thinkingLevel as never,
      undefined,
      options.auth.env,
    );
    if (options.signal?.aborted) return undefined;

    const baseDetails = (summaryResult.details ?? {}) as CompactionEntryDetails;
    return {
      ...summaryResult,
      details: {
        readFiles: baseDetails.readFiles,
        modifiedFiles: baseDetails.modifiedFiles,
        ...(options.recovery ? { recovery: options.recovery } : {}),
      },
    };
  } catch {
    return undefined;
  }
}

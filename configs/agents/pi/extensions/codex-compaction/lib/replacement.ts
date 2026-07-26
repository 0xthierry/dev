import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isCompatibleV2Binding } from "./binding";
import { isCodexPayload, itemContainsText, repairOrphanCodexToolOutputs } from "./payload";
import { extractV1Sentinel, isArtifactUnusable, isValidArtifact, latestCompaction } from "./state";
import { type InjectionMode, type JsonObject, SUMMARY_SEARCH_WINDOW } from "./types";
import { prefixesEqual } from "./user-prefix";

export type ReplacementResult =
  | { mutated: true; mode: "artifact" | "prefix-only" }
  | { mutated: false; reason: string };

export function planInjection(options: {
  model: Model<Api>;
  branchEntries: SessionEntry[];
  accountHash: string | undefined;
}): InjectionMode {
  if (options.model.api !== "openai-codex-responses") {
    return { kind: "none", reason: "not-codex-payload" };
  }

  const latest = latestCompaction(options.branchEntries);
  if (latest.kind === "none" || latest.kind === "ordinary") {
    return { kind: "none", reason: "no-active-compaction" };
  }

  const artifactUnusable = isArtifactUnusable(options.branchEntries);

  if (latest.kind === "v1") {
    const bindingMatch =
      latest.record.provider === options.model.provider &&
      latest.record.api === options.model.api &&
      latest.record.modelId === options.model.id;

    if (!artifactUnusable && bindingMatch) {
      return { kind: "artifact", userPrefix: [], artifact: [latest.record.item] };
    }
    return { kind: "none", reason: artifactUnusable ? "invalidated" : "binding-mismatch" };
  }

  const bindingMatch = isCompatibleV2Binding(latest.record, options.model, options.accountHash);
  const artifactOk = isValidArtifact(latest.record.artifact);

  if (!artifactUnusable && bindingMatch && artifactOk) {
    return {
      kind: "artifact",
      userPrefix: latest.record.userPrefix,
      artifact: latest.record.artifact,
    };
  }

  // Seam strikes / invalid artifact / binding mismatch: prefix-only when we have a validated prefix.
  if (latest.record.userPrefix.length > 0) {
    return { kind: "prefix-only", userPrefix: latest.record.userPrefix };
  }

  return {
    kind: "none",
    reason: artifactUnusable ? "invalidated" : bindingMatch ? "invalid-artifact" : "binding-mismatch",
  };
}

export function applyCompactionReplacement(options: {
  payload: unknown;
  model: Model<Api>;
  branchEntries: SessionEntry[];
  accountHash: string | undefined;
}): ReplacementResult {
  if (options.model.api !== "openai-codex-responses" || !isCodexPayload(options.payload)) {
    return { mutated: false, reason: "not-codex-payload" };
  }

  const latest = latestCompaction(options.branchEntries);
  if (latest.kind === "none") return { mutated: false, reason: "no-active-compaction" };

  const plan = planInjection(options);
  if (plan.kind === "none") return { mutated: false, reason: plan.reason };

  const summaryIndex = findSummaryItemIndex(options.payload.input, latest);
  if (summaryIndex === -1) return { mutated: false, reason: "summary-not-found" };

  if (plan.kind === "prefix-only") {
    if (hasIdenticalPrefixBefore(options.payload.input, summaryIndex, plan.userPrefix)) {
      return { mutated: false, reason: "prefix-already-present" };
    }
    options.payload.input.splice(summaryIndex, 0, ...plan.userPrefix);
    return { mutated: true, mode: "prefix-only" };
  }

  const replacement = [...plan.userPrefix, ...plan.artifact];
  options.payload.input.splice(summaryIndex, 1, ...replacement);
  const boundaryIndex = summaryIndex + replacement.length - 1;
  repairOrphanCodexToolOutputs(options.payload, options.branchEntries, boundaryIndex);
  return { mutated: true, mode: "artifact" };
}

export function findSummaryItemIndex(
  input: JsonObject[],
  latest: Exclude<ReturnType<typeof latestCompaction>, { kind: "none" }>,
): number {
  const window = input.slice(0, SUMMARY_SEARCH_WINDOW);

  if (latest.kind === "v1") {
    const sentinel = extractV1Sentinel(latest.entry.summary, latest.record);
    if (!sentinel) return -1;
    return window.findIndex((item) => itemContainsText(item, sentinel));
  }

  const summary = latest.entry.summary;
  if (typeof summary !== "string" || summary.length === 0) return -1;
  return window.findIndex((item) => itemContainsText(item, summary));
}

export function hasIdenticalPrefixBefore(input: JsonObject[], summaryIndex: number, userPrefix: JsonObject[]): boolean {
  if (userPrefix.length === 0 || summaryIndex < userPrefix.length) return false;
  const adjacent = input.slice(summaryIndex - userPrefix.length, summaryIndex);
  return prefixesEqual(adjacent, userPrefix);
}

import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isInvalidated, latestActiveCodexCompaction } from "./state";
import type { InjectionResult, JsonObject } from "./types";

export function injectCodexCompactionIntoPayload(
  payload: unknown,
  model: Model<Api> | undefined,
  branchEntries: SessionEntry[],
): InjectionResult {
  if (model?.api !== "openai-codex-responses" || !isCodexPayload(payload)) {
    return { injected: false, reason: "not-codex-payload" };
  }

  const active = latestActiveCodexCompaction(branchEntries);
  if (
    !active ||
    active.details.provider !== model.provider ||
    active.details.api !== model.api ||
    active.details.modelId !== model.id
  ) {
    return { injected: false, reason: "no-active-compaction" };
  }

  if (isInvalidated(branchEntries, active.details.sentinel)) {
    return { injected: false, reason: "invalidated" };
  }

  const index = payload.input.findIndex((item) => itemContainsSentinel(item, active.details.sentinel));
  if (index === -1) return { injected: false, reason: "summary-not-found" };

  payload.input[index] = active.details.item;
  return { injected: true, sentinel: active.details.sentinel };
}

export function isCodexPayload(payload: unknown): payload is { input: JsonObject[] } {
  return isJsonObject(payload) && Array.isArray(payload.input) && payload.input.every(isJsonObject);
}

export function itemContainsSentinel(item: unknown, sentinel: string): boolean {
  if (!isJsonObject(item)) return false;

  if (typeof item.content === "string" && item.content.includes(sentinel)) return true;

  if (Array.isArray(item.content)) {
    return item.content.some(
      (content) => isJsonObject(content) && typeof content.text === "string" && content.text.includes(sentinel),
    );
  }

  return false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

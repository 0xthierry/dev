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

export function repairOrphanCodexToolOutputs(payload: unknown, branchEntries: SessionEntry[]): boolean {
  if (!isCodexPayload(payload)) return false;

  const recoveredCalls = recoveredToolCalls(branchEntries);
  const seenCallIds = new Set<string>();
  let repaired = false;

  for (let index = 0; index < payload.input.length; index += 1) {
    const item = payload.input[index];
    if (item.type === "function_call" && typeof item.call_id === "string") {
      seenCallIds.add(item.call_id);
      continue;
    }

    if (item.type !== "function_call_output" || typeof item.call_id !== "string" || seenCallIds.has(item.call_id)) {
      continue;
    }

    const recoveredCall = recoveredCalls.get(item.call_id);
    if (!recoveredCall) continue;

    payload.input.splice(index, 0, recoveredCall);
    seenCallIds.add(item.call_id);
    repaired = true;
    index += 1;
  }

  return repaired;
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

function recoveredToolCalls(entries: SessionEntry[]): Map<string, JsonObject> {
  const recovered = new Map<string, JsonObject>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    const message = entry.message as { role?: unknown; toolCallId?: unknown; toolName?: unknown } | undefined;
    if (message?.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
    if (typeof message.toolName !== "string" || message.toolName.length === 0) continue;

    const [callId, itemId] = message.toolCallId.split("|");
    if (!callId || recovered.has(callId)) continue;

    recovered.set(callId, {
      type: "function_call",
      id: itemId && itemId.length > 0 ? itemId : `fc_pi_recovered_${callId}`,
      call_id: callId,
      name: message.toolName,
      arguments: "{}",
    });
  }

  return recovered;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

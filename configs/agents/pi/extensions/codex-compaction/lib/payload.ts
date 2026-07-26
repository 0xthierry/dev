import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { isSeamRepairDisabled } from "./state";
import type { JsonObject } from "./types";

export function isCodexPayload(payload: unknown): payload is { input: JsonObject[] } {
  return isJsonObject(payload) && Array.isArray(payload.input) && payload.input.every(isJsonObject);
}

export function itemContainsText(item: unknown, text: string): boolean {
  if (!isJsonObject(item) || text.length === 0) return false;

  if (typeof item.content === "string" && item.content.includes(text)) return true;

  if (Array.isArray(item.content)) {
    return item.content.some(
      (content) => isJsonObject(content) && typeof content.text === "string" && content.text.includes(text),
    );
  }

  return false;
}

/**
 * Seam repair runs only after artifact substitution and only after the inserted boundary.
 * Prefer real assistant toolCall name+arguments; fallback toolResult name+{}; else drop orphan.
 */
export function repairOrphanCodexToolOutputs(
  payload: unknown,
  branchEntries: SessionEntry[],
  afterIndex = -1,
): boolean {
  if (!isCodexPayload(payload)) return false;
  if (isSeamRepairDisabled(branchEntries)) return false;

  const recoveredCalls = recoveredToolCalls(branchEntries);
  const seenCallIds = new Set<string>();
  let repaired = false;

  for (let index = 0; index < payload.input.length; index += 1) {
    if (index <= afterIndex) {
      const early = payload.input[index];
      if (early.type === "function_call" && typeof early.call_id === "string") {
        seenCallIds.add(early.call_id);
      }
      continue;
    }

    const item = payload.input[index];
    if (item.type === "function_call" && typeof item.call_id === "string") {
      seenCallIds.add(item.call_id);
      continue;
    }

    if (item.type !== "function_call_output" || typeof item.call_id !== "string" || seenCallIds.has(item.call_id)) {
      continue;
    }

    const recoveredCall = recoveredCalls.get(item.call_id);
    if (!recoveredCall) {
      payload.input.splice(index, 1);
      index -= 1;
      repaired = true;
      continue;
    }

    payload.input.splice(index, 0, recoveredCall);
    seenCallIds.add(item.call_id);
    repaired = true;
    index += 1;
  }

  return repaired;
}

function recoveredToolCalls(entries: SessionEntry[]): Map<string, JsonObject> {
  const fromAssistant = new Map<string, JsonObject>();
  const fromToolResult = new Map<string, JsonObject>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message as
      | {
          role?: unknown;
          content?: unknown;
          toolCallId?: unknown;
          toolName?: unknown;
        }
      | undefined;

    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!isJsonObject(block) || block.type !== "toolCall") continue;
        if (typeof block.id !== "string" || typeof block.name !== "string") continue;
        const [callId, itemId] = block.id.split("|");
        if (!callId || fromAssistant.has(callId)) continue;
        fromAssistant.set(callId, {
          type: "function_call",
          id: itemId && itemId.length > 0 ? itemId : `fc_pi_recovered_${callId}`,
          call_id: callId,
          name: block.name,
          arguments: JSON.stringify(block.arguments ?? {}),
        });
      }
      continue;
    }

    if (message?.role !== "toolResult" || typeof message.toolCallId !== "string") continue;
    if (typeof message.toolName !== "string" || message.toolName.length === 0) continue;

    const [callId, itemId] = message.toolCallId.split("|");
    if (!callId || fromToolResult.has(callId)) continue;

    fromToolResult.set(callId, {
      type: "function_call",
      id: itemId && itemId.length > 0 ? itemId : `fc_pi_recovered_${callId}`,
      call_id: callId,
      name: message.toolName,
      arguments: "{}",
    });
  }

  const recovered = new Map<string, JsonObject>(fromToolResult);
  for (const [callId, call] of fromAssistant) recovered.set(callId, call);
  return recovered;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

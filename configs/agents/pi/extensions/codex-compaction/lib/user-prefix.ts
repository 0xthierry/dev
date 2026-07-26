import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonObject } from "./types";

export function buildUserPrefix(options: {
  previousUserPrefix?: JsonObject[];
  discardedMessages: AgentMessage[];
  keepRecentTokens: number;
}): JsonObject[] {
  const candidates = [
    ...(options.previousUserPrefix ?? []).filter(isUserPrefixItem),
    ...options.discardedMessages.flatMap((message) => {
      const item = literalUserToPrefixItem(message);
      return item ? [item] : [];
    }),
  ];

  return selectNewestWithinBudget(candidates, options.keepRecentTokens);
}

export function literalUserToPrefixItem(message: AgentMessage): JsonObject | undefined {
  if (message.role !== "user") return undefined;

  if (typeof message.content === "string") {
    return message.content.length > 0 ? { role: "user", content: message.content } : undefined;
  }

  if (!Array.isArray(message.content)) return undefined;

  // Retain text blocks; ignore image (and other non-text) blocks. Drop only when no text remains.
  const textParts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text.length > 0) textParts.push(block.text);
  }

  if (textParts.length === 0) return undefined;
  return { role: "user", content: textParts.join("\n") };
}

export function isUserPrefixItem(value: unknown): value is JsonObject {
  if (!isJsonObject(value) || value.role !== "user") return false;
  if (typeof value.content === "string") return true;
  if (!Array.isArray(value.content)) return false;
  return value.content.every(
    (part) =>
      isJsonObject(part) && (part.type === "input_text" || part.type === "text") && typeof part.text === "string",
  );
}

export function prefixesEqual(left: JsonObject[], right: JsonObject[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (JSON.stringify(left[index]) !== JSON.stringify(right[index])) return false;
  }
  return true;
}

/**
 * Strict estimated-token ceiling.
 * - budget <= 0 => []
 * - never force an oversized item through; omit it and stop (preserve whole-item semantics)
 */
function selectNewestWithinBudget(items: JsonObject[], keepRecentTokens: number): JsonObject[] {
  if (keepRecentTokens <= 0) return [];

  const selected: JsonObject[] = [];
  let totalTokens = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const tokens = estimatePrefixItemTokens(item);
    if (totalTokens + tokens > keepRecentTokens) {
      // Oversized for remaining budget: omit (do not truncate) and stop walking older items.
      break;
    }
    selected.unshift(item);
    totalTokens += tokens;
  }

  return selected;
}

function estimatePrefixItemTokens(item: JsonObject): number {
  if (typeof item.content === "string") return Math.ceil(item.content.length / 4);
  if (!Array.isArray(item.content)) return 1;

  let chars = 0;
  for (const part of item.content) {
    if (isJsonObject(part) && typeof part.text === "string") chars += part.text.length;
  }
  return Math.max(1, Math.ceil(chars / 4));
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

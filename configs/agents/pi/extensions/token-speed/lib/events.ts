const TOKEN_DELTA_EVENT_TYPES = new Set(["text_delta", "thinking_delta"]);

export function isAssistantMessage(message: unknown): message is { role: "assistant" } {
  return isRecord(message) && message.role === "assistant";
}

export function getAssistantDeltaTokenCount(event: unknown): number {
  if (!isRecord(event) || !TOKEN_DELTA_EVENT_TYPES.has(String(event.type))) return 0;
  return typeof event.delta === "string" && event.delta.length > 0 ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

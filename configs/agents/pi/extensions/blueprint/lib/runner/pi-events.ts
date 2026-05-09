export interface PiChildEventState {
  finalOutput: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

export function createPiChildEventState(): PiChildEventState {
  return { finalOutput: "" };
}

export function applyPiChildJsonEvent(state: PiChildEventState, line: string): boolean {
  if (!line.trim()) return false;

  let event: unknown;
  try {
    event = JSON.parse(line) as unknown;
  } catch {
    return false;
  }

  if (!event || typeof event !== "object") return false;
  const record = event as Record<string, unknown>;
  if (record.type !== "message_end") return false;

  const message = objectValue(record.message);
  if (!message || message.role !== "assistant") return false;

  const text = textFromContentParts(message.content);
  if (text) state.finalOutput = text;
  if (typeof message.model === "string") state.model = message.model;
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  if (typeof message.errorMessage === "string") state.errorMessage = message.errorMessage;
  return true;
}

export function textFromContentParts(content: unknown): string {
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const value = part as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") parts.push(value.text);
  }
  return parts.join("\n");
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

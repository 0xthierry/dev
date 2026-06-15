export interface OracleConversationText {
  text: string;
  messageId?: string;
  currentNode?: string;
  status?: string;
  finished: boolean;
}

interface CandidateMessage {
  text: string;
  messageId?: string;
  status?: string;
  createTime: number;
  order: number;
}

export function extractOracleConversationText(conversation: unknown): OracleConversationText | null {
  if (!isRecord(conversation)) return null;
  const currentNode = optionalString(getRecordValue(conversation, "current_node"));
  const mapping = getRecordValue(conversation, "mapping");
  if (!isRecord(mapping)) return null;

  const candidates: CandidateMessage[] = [];
  let order = 0;
  for (const node of Object.values(mapping)) {
    const message = getRecordValue(node, "message");
    if (!isRecord(message)) continue;
    const author = getRecordValue(message, "author");
    if (!isRecord(author) || getRecordValue(author, "role") !== "assistant") continue;

    const text = extractTextFromMessage(message).trim();
    if (!text) continue;
    candidates.push({
      text,
      messageId: optionalString(getRecordValue(message, "id")),
      status: optionalString(getRecordValue(message, "status")),
      createTime: optionalNumber(getRecordValue(message, "create_time")) ?? 0,
      order,
    });
    order += 1;
  }

  const candidate = candidates
    .sort((left, right) => left.createTime - right.createTime || left.order - right.order)
    .at(-1);
  if (!candidate) return null;
  return {
    text: candidate.text,
    messageId: candidate.messageId,
    currentNode: currentNode ?? candidate.messageId,
    status: candidate.status,
    finished: candidate.status === "finished_successfully" || candidate.status === "finished_partial_completion",
  };
}

function extractTextFromMessage(message: Record<string, unknown>): string {
  const content = getRecordValue(message, "content");
  if (!isRecord(content)) return "";
  const parts = getRecordValue(content, "parts");
  if (!Array.isArray(parts)) return "";

  const textParts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") textParts.push(part);
    if (isRecord(part) && getRecordValue(part, "content_type") === "text") {
      const text = getRecordValue(part, "text");
      if (typeof text === "string") textParts.push(text);
    }
  }
  return textParts.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

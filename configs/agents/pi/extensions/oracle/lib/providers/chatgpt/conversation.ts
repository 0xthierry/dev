export interface OracleConversationText {
  text: string;
  messageId: string;
  currentNode: string;
  model?: string;
  status: string;
  finished: true;
}

export type OracleTurnScope = { kind: "pro"; turnExchangeId: string } | { kind: "instant"; requestMessageId: string };

interface ConversationMessage {
  id?: string;
  role?: string;
  recipient?: string;
  channel?: string;
  contentType?: string;
  text: string;
  status?: string;
  endTurn?: boolean;
  turnExchangeId?: string;
  reasoningStatus?: string;
  finishType?: string;
  model?: string;
  visuallyHidden: boolean;
}

interface ConversationNode {
  key: string;
  parent?: string;
  message?: ConversationMessage;
}

interface ParsedConversation {
  currentNode?: string;
  nodes: Map<string, ConversationNode>;
}

interface AssistantCandidate {
  key: string;
  message: ConversationMessage;
}

export function extractOracleConversationText(
  conversation: unknown,
  scope: OracleTurnScope,
): OracleConversationText | null {
  const parsed = parseConversation(conversation);
  if (!parsed) return null;

  const candidate =
    scope.kind === "pro"
      ? findCompletedProTurn(parsed, scope.turnExchangeId)
      : findCompletedInstantTurn(parsed, scope.requestMessageId);
  if (!candidate?.message.id || !candidate.message.status) return null;

  return {
    text: candidate.message.text,
    messageId: candidate.message.id,
    currentNode: candidate.message.id,
    model: candidate.message.model,
    status: candidate.message.status,
    finished: true,
  };
}

function findCompletedProTurn(parsed: ParsedConversation, turnExchangeId: string): AssistantCandidate | null {
  const turnMessages = assistantMessages(parsed).filter(({ message }) => message.turnExchangeId === turnExchangeId);
  const reasoningEnded = turnMessages.filter(
    ({ message }) =>
      message.contentType === "reasoning_recap" &&
      message.recipient === "all" &&
      message.status === "finished_successfully" &&
      message.endTurn === true &&
      message.reasoningStatus === "reasoning_ended",
  );
  if (reasoningEnded.length === 0) return null;

  const activeReasoning = turnMessages.filter(
    ({ message }) =>
      (message.contentType === "thoughts" || message.contentType === "reasoning" || message.contentType === "code") &&
      message.reasoningStatus === "is_reasoning",
  );
  const finalCandidates = turnMessages.filter(
    (candidate) =>
      isFinalText(candidate.message, false) &&
      reasoningEnded.some((recap) => isDescendantOf(parsed.nodes, candidate.key, recap.key)) &&
      activeReasoning.every((active) => isDescendantOf(parsed.nodes, candidate.key, active.key)),
  );

  return selectUniqueCurrentBranchLeaf(parsed, finalCandidates);
}

function findCompletedInstantTurn(parsed: ParsedConversation, requestMessageId: string): AssistantCandidate | null {
  const requestNode = [...parsed.nodes.values()].find(
    (node) => node.key === requestMessageId || node.message?.id === requestMessageId,
  );
  if (!requestNode) return null;

  const finalCandidates = assistantMessages(parsed).filter(
    (candidate) => isDescendantOf(parsed.nodes, candidate.key, requestNode.key) && isFinalText(candidate.message, true),
  );
  return selectUniqueCurrentBranchLeaf(parsed, finalCandidates);
}

function isFinalText(message: ConversationMessage, allowLegacyFields: boolean): boolean {
  const contentTypeIsFinal =
    message.contentType === "text" ||
    message.contentType === "multimodal_text" ||
    (allowLegacyFields && message.contentType === undefined);
  const recipientIsFinal = message.recipient === "all" || (allowLegacyFields && message.recipient === undefined);
  return (
    contentTypeIsFinal &&
    recipientIsFinal &&
    (message.channel === undefined || message.channel === "final") &&
    message.status === "finished_successfully" &&
    message.endTurn === true &&
    (message.finishType === undefined || message.finishType === "stop") &&
    !message.visuallyHidden &&
    Boolean(message.id && message.text.trim())
  );
}

function selectUniqueCurrentBranchLeaf(
  parsed: ParsedConversation,
  candidates: AssistantCandidate[],
): AssistantCandidate | null {
  let branchCandidates = candidates;
  const currentNode = parsed.currentNode;
  if (currentNode) {
    if (!parsed.nodes.has(currentNode)) return null;
    branchCandidates = candidates.filter(
      (candidate) => candidate.key === currentNode || isDescendantOf(parsed.nodes, currentNode, candidate.key),
    );
  }

  const leaves = branchCandidates.filter(
    (candidate) =>
      !branchCandidates.some(
        (other) => other.key !== candidate.key && isDescendantOf(parsed.nodes, other.key, candidate.key),
      ),
  );
  return leaves.length === 1 ? (leaves[0] ?? null) : null;
}

function assistantMessages(parsed: ParsedConversation): AssistantCandidate[] {
  const candidates: AssistantCandidate[] = [];
  for (const node of parsed.nodes.values()) {
    if (node.message?.role === "assistant") candidates.push({ key: node.key, message: node.message });
  }
  return candidates;
}

function parseConversation(conversation: unknown): ParsedConversation | null {
  if (!isRecord(conversation)) return null;
  const mapping = getRecordValue(conversation, "mapping");
  if (!isRecord(mapping)) return null;

  const nodes = new Map<string, ConversationNode>();
  for (const [key, rawNode] of Object.entries(mapping)) {
    if (!isRecord(rawNode)) continue;
    const rawMessage = getRecordValue(rawNode, "message");
    nodes.set(key, {
      key,
      parent: optionalString(getRecordValue(rawNode, "parent")),
      message: isRecord(rawMessage) ? parseMessage(rawMessage) : undefined,
    });
  }

  return {
    currentNode: optionalString(getRecordValue(conversation, "current_node")),
    nodes,
  };
}

function parseMessage(message: Record<string, unknown>): ConversationMessage {
  const author = getRecordValue(message, "author");
  const metadata = getRecordValue(message, "metadata");
  const finishDetails = isRecord(metadata) ? getRecordValue(metadata, "finish_details") : undefined;
  const content = getRecordValue(message, "content");

  return {
    id: optionalString(getRecordValue(message, "id")),
    role: isRecord(author) ? optionalString(getRecordValue(author, "role")) : undefined,
    recipient: optionalString(getRecordValue(message, "recipient")),
    channel: optionalString(getRecordValue(message, "channel")),
    contentType: isRecord(content) ? optionalString(getRecordValue(content, "content_type")) : undefined,
    text: isRecord(content) ? extractTextFromContent(content).trim() : "",
    status: optionalString(getRecordValue(message, "status")),
    endTurn: optionalBoolean(getRecordValue(message, "end_turn")),
    turnExchangeId: isRecord(metadata) ? optionalString(getRecordValue(metadata, "turn_exchange_id")) : undefined,
    reasoningStatus: isRecord(metadata) ? optionalString(getRecordValue(metadata, "reasoning_status")) : undefined,
    finishType: isRecord(finishDetails) ? optionalString(getRecordValue(finishDetails, "type")) : undefined,
    model: isRecord(metadata) ? optionalString(getRecordValue(metadata, "model_slug")) : undefined,
    visuallyHidden: isRecord(metadata) && getRecordValue(metadata, "is_visually_hidden") === true,
  };
}

function extractTextFromContent(content: Record<string, unknown>): string {
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

function isDescendantOf(nodes: Map<string, ConversationNode>, descendantKey: string, ancestorKey: string): boolean {
  if (descendantKey === ancestorKey) return false;

  const seen = new Set<string>();
  let currentKey: string | undefined = descendantKey;
  while (currentKey && !seen.has(currentKey)) {
    seen.add(currentKey);
    const parent: string | undefined = nodes.get(currentKey)?.parent;
    if (!parent) return false;
    if (parent === ancestorKey) return true;
    currentKey = parent;
  }
  return false;
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

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export interface OracleSessionState {
  conversationId: string;
  currentNode: string;
  projectId?: string;
  model?: string;
}

export function restoreOracleSessionState(entries: readonly unknown[]): OracleSessionState | undefined {
  let latest: OracleSessionState | undefined;

  for (const entry of entries) {
    const message = messageFromEntry(entry);
    if (!message || message.role !== "toolResult" || message.toolName !== "oracle") continue;

    const details = objectValue(message.details);
    const state = stateFromDetails(details);
    if (state) latest = state;
  }

  return latest;
}

export function isOracleSessionStateCompatible(
  state: OracleSessionState | undefined,
  projectId: string | undefined,
): state is OracleSessionState {
  if (!state) return false;
  return (state.projectId ?? "") === (projectId ?? "");
}

function stateFromDetails(details: Record<string, unknown> | undefined): OracleSessionState | undefined {
  if (!details || details.ok !== true) return undefined;
  const conversationId = stringValue(details.conversationId);
  const currentNode = stringValue(details.currentNode);
  if (!conversationId || !currentNode) return undefined;

  return {
    conversationId,
    currentNode,
    projectId: stringValue(details.projectId),
    model: stringValue(details.model),
  };
}

function messageFromEntry(entry: unknown): Record<string, unknown> | undefined {
  const value = objectValue(entry);
  return objectValue(value?.message);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

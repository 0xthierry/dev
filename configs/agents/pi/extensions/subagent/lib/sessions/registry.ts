export interface AgentSessionRecord {
  agentId: string;
  agent: string;
  sessionFile: string;
  task?: string;
}

export type AgentSessionRecordLookupResult =
  | { ok: true; record: AgentSessionRecord }
  | { ok: false; reason: "not-found" | "ambiguous"; matches: AgentSessionRecord[] };

export function restoreAgentSessionRecords(entries: readonly unknown[]): AgentSessionRecord[] {
  const recordsById = new Map<string, AgentSessionRecord>();

  for (const entry of entries) {
    const message = messageFromEntry(entry);
    if (!message || message.role !== "toolResult" || !isAgentToolName(message.toolName)) continue;

    const details = objectValue(message.details);
    const results = Array.isArray(details?.results) ? details.results : [];
    for (const result of results) {
      const record = recordFromAgentRunResult(result);
      if (record) recordsById.set(record.agentId, record);
    }
  }

  return [...recordsById.values()];
}

export function findAgentSessionRecord(
  records: readonly AgentSessionRecord[],
  agentIdOrPrefix: string,
): AgentSessionRecordLookupResult {
  const needle = agentIdOrPrefix.trim();
  if (!needle) return { ok: false, reason: "not-found", matches: [] };

  const matches = records.filter((record) => record.agentId.startsWith(needle));
  if (matches.length === 1) return { ok: true, record: matches[0] };
  return { ok: false, reason: matches.length > 1 ? "ambiguous" : "not-found", matches };
}

function recordFromAgentRunResult(result: unknown): AgentSessionRecord | undefined {
  const value = objectValue(result);
  const agentId = stringValue(value?.agentId);
  const agent = stringValue(value?.agent);
  const sessionFile = stringValue(value?.sessionFile);
  if (!agentId || !agent || !sessionFile) return undefined;

  return {
    agentId,
    agent,
    sessionFile,
    task: stringValue(value?.task),
  };
}

function messageFromEntry(entry: unknown): Record<string, unknown> | undefined {
  const value = objectValue(entry);
  return objectValue(value?.message);
}

function isAgentToolName(value: unknown): boolean {
  return value === "agent" || value === "Agent";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

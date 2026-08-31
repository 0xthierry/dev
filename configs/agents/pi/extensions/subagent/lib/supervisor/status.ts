export const AGENT_STATUSES = [
  "queued",
  "starting",
  "running",
  "idle",
  "interrupted",
  "failed",
  "unloaded",
  "closed",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

const ACTIVE_STATUSES = new Set<AgentStatus>(["starting", "running"]);
const RESUMABLE_STATUSES = new Set<AgentStatus>(["idle", "interrupted", "failed", "unloaded"]);

export function isActiveStatus(status: AgentStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function isResumableStatus(status: AgentStatus): boolean {
  return RESUMABLE_STATUSES.has(status);
}

export function isTerminalStatus(status: AgentStatus): boolean {
  return status === "closed";
}

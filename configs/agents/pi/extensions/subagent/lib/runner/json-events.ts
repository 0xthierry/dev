import { textFromContentParts } from "./output";

export interface AgentUsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  totalTokens: number;
  turns: number;
}

export interface ChildAgentEventState {
  finalOutput: string;
  usage: AgentUsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

export function createChildAgentEventState(): ChildAgentEventState {
  return {
    finalOutput: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 0 },
  };
}

export function applyChildJsonEvent(state: ChildAgentEventState, line: string): boolean {
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

  const output = textFromContentParts(message.content);
  if (output) state.finalOutput = output;

  state.usage.turns += 1;
  addUsage(state.usage, objectValue(message.usage));
  if (typeof message.model === "string") state.model = message.model;
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  if (typeof message.errorMessage === "string") state.errorMessage = message.errorMessage;
  return true;
}

function addUsage(total: AgentUsageStats, usage: Record<string, unknown> | undefined): void {
  if (!usage) return;

  total.input += numberValue(usage.input);
  total.output += numberValue(usage.output);
  total.cacheRead += numberValue(usage.cacheRead);
  total.cacheWrite += numberValue(usage.cacheWrite);
  total.totalTokens = numberValue(usage.totalTokens) || total.totalTokens;

  const cost = objectValue(usage.cost);
  total.cost += numberValue(cost?.total);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

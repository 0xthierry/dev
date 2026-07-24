import { textFromContentParts } from "./output";

const MAX_ACTIVITY_ITEMS = 40;
const MAX_ACTIVITY_TEXT_CHARS = 2_000;
const MAX_PREVIEW_CHARS = 240;

export interface AgentUsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  totalTokens: number;
  turns: number;
}

export type AgentActivityItem = AgentAssistantActivityItem | AgentToolActivityItem;

export interface AgentAssistantActivityItem {
  kind: "assistant";
  status: "running" | "completed";
  text: string;
}

export interface AgentToolActivityItem {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  status: "running" | "succeeded" | "failed";
  argsPreview: string;
  outputPreview?: string;
}

export interface ChildAgentEventState {
  finalOutput: string;
  durationMs: number;
  usage: AgentUsageStats;
  activity: AgentActivityItem[];
  currentAssistantText: string;
  agentEnded: boolean;
  sessionId?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

export function createChildAgentEventState(): ChildAgentEventState {
  return {
    finalOutput: "",
    durationMs: 0,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 0 },
    activity: [],
    currentAssistantText: "",
    agentEnded: false,
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

  switch (record.type) {
    case "session":
      return applySessionHeader(state, record);
    case "message_update":
      return applyAssistantMessageUpdate(state, record);
    case "message_end":
      return applyMessageEnd(state, record);
    case "tool_execution_start":
      return applyToolExecutionStart(state, record);
    case "tool_execution_update":
      return applyToolExecutionUpdate(state, record);
    case "tool_execution_end":
      return applyToolExecutionEnd(state, record);
    case "agent_end":
      return applyAgentEnd(state);
    default:
      return false;
  }
}

function applySessionHeader(state: ChildAgentEventState, record: Record<string, unknown>): boolean {
  const sessionId = stringValue(record.id);
  if (!sessionId || state.sessionId === sessionId) return false;
  state.sessionId = sessionId;
  return true;
}

function applyAgentEnd(state: ChildAgentEventState): boolean {
  if (state.agentEnded) return false;
  state.agentEnded = true;
  return true;
}

function applyAssistantMessageUpdate(state: ChildAgentEventState, record: Record<string, unknown>): boolean {
  const message = objectValue(record.message);
  if (!message || message.role !== "assistant") return false;

  const output = textFromContentParts(message.content) || appendAssistantDelta(state, record);
  if (!output || output === state.currentAssistantText) return false;

  state.currentAssistantText = output;
  upsertAssistantActivity(state, output, "running");
  return true;
}

function applyMessageEnd(state: ChildAgentEventState, record: Record<string, unknown>): boolean {
  const message = objectValue(record.message);
  if (!message || message.role !== "assistant") return false;

  const output = textFromContentParts(message.content);
  if (output) {
    state.finalOutput = output;
    upsertAssistantActivity(state, output, "completed");
  }
  state.currentAssistantText = "";

  state.usage.turns += 1;
  addUsage(state.usage, objectValue(message.usage));
  if (typeof message.model === "string") state.model = message.model;
  if (typeof message.stopReason === "string") state.stopReason = message.stopReason;
  if (typeof message.errorMessage === "string") state.errorMessage = message.errorMessage;
  return true;
}

function applyToolExecutionStart(state: ChildAgentEventState, record: Record<string, unknown>): boolean {
  const toolCallId = stringValue(record.toolCallId) ?? `tool-${state.activity.length + 1}`;
  const toolName = stringValue(record.toolName) ?? "tool";
  appendActivity(state, {
    kind: "tool",
    toolCallId,
    toolName,
    status: "running",
    argsPreview: summarizeToolArguments(toolName, record.args),
  });
  return true;
}

function applyToolExecutionUpdate(state: ChildAgentEventState, record: Record<string, unknown>): boolean {
  const toolCallId = stringValue(record.toolCallId);
  if (!toolCallId) return false;

  updateToolActivity(state, toolCallId, {
    status: "running",
    outputPreview: previewFromToolResult(record.partialResult),
  });
  return true;
}

function applyToolExecutionEnd(state: ChildAgentEventState, record: Record<string, unknown>): boolean {
  const toolCallId = stringValue(record.toolCallId);
  if (!toolCallId) return false;

  updateToolActivity(state, toolCallId, {
    status: record.isError === true ? "failed" : "succeeded",
    outputPreview: previewFromToolResult(record.result),
  });
  return true;
}

function upsertAssistantActivity(
  state: ChildAgentEventState,
  text: string,
  status: AgentAssistantActivityItem["status"],
): void {
  const preview = truncatePreview(text, MAX_ACTIVITY_TEXT_CHARS);
  const last = state.activity.at(-1);
  if (last?.kind === "assistant" && last.status === "running") {
    last.text = preview;
    last.status = status;
    return;
  }
  appendActivity(state, { kind: "assistant", status, text: preview });
}

function updateToolActivity(
  state: ChildAgentEventState,
  toolCallId: string,
  patch: Pick<AgentToolActivityItem, "status"> & Partial<Pick<AgentToolActivityItem, "outputPreview">>,
): void {
  const existing = state.activity.find(
    (item): item is AgentToolActivityItem => item.kind === "tool" && item.toolCallId === toolCallId,
  );
  if (existing) {
    existing.status = patch.status;
    if (patch.outputPreview) existing.outputPreview = patch.outputPreview;
    return;
  }

  appendActivity(state, {
    kind: "tool",
    toolCallId,
    toolName: "tool",
    argsPreview: "",
    status: patch.status,
    outputPreview: patch.outputPreview,
  });
}

function appendActivity(state: ChildAgentEventState, item: AgentActivityItem): void {
  state.activity.push(item);
  const overflow = state.activity.length - MAX_ACTIVITY_ITEMS;
  if (overflow > 0) state.activity.splice(0, overflow);
}

function appendAssistantDelta(state: ChildAgentEventState, record: Record<string, unknown>): string {
  const assistantEvent = objectValue(record.assistantMessageEvent);
  const delta = assistantEvent?.type === "text_delta" ? stringValue(assistantEvent.delta) : undefined;
  return delta ? `${state.currentAssistantText}${delta}` : "";
}

function summarizeToolArguments(toolName: string, args: unknown): string {
  const value = objectValue(args);
  if (!value) return "";

  switch (toolName) {
    case "bash":
      return stringValue(value.command)
        ? `$ ${truncatePreview(stringValue(value.command) ?? "", MAX_PREVIEW_CHARS)}`
        : "";
    case "read":
      return joinParts("read", pathPreview(value.path ?? value.file_path), lineRangePreview(value));
    case "write":
      return joinParts("write", pathPreview(value.path ?? value.file_path), contentSizePreview(value.content));
    case "edit":
      return joinParts("edit", pathPreview(value.path ?? value.file_path));
    case "ls":
      return joinParts("ls", pathPreview(value.path ?? "."));
    case "find":
      return joinParts("find", stringValue(value.pattern) ?? "*", `in ${pathPreview(value.path ?? ".")}`);
    case "grep":
      return joinParts(
        "grep",
        stringValue(value.pattern) ? `/${stringValue(value.pattern)}/` : "",
        `in ${pathPreview(value.path ?? ".")}`,
      );
    default:
      return truncatePreview(JSON.stringify(value) ?? "", MAX_PREVIEW_CHARS);
  }
}

function lineRangePreview(value: Record<string, unknown>): string {
  const offset = numberValue(value.offset);
  const limit = numberValue(value.limit);
  if (!offset && !limit) return "";

  const start = offset || 1;
  const end = limit ? start + limit - 1 : undefined;
  return `:${start}${end ? `-${end}` : ""}`;
}

function contentSizePreview(value: unknown): string {
  if (typeof value !== "string") return "";
  const lines = value.split("\n").length;
  return lines > 1 ? `(${lines} lines)` : "";
}

function pathPreview(value: unknown): string {
  return truncatePreview(String(value ?? "..."), MAX_PREVIEW_CHARS);
}

function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(" ");
}

function previewFromToolResult(result: unknown): string | undefined {
  if (typeof result === "string") return truncatePreview(result, MAX_PREVIEW_CHARS);

  const value = objectValue(result);
  if (!value) return undefined;

  const contentText = textFromContentParts(value.content);
  if (contentText) return truncatePreview(contentText, MAX_PREVIEW_CHARS);

  if (typeof value.output === "string") return truncatePreview(value.output, MAX_PREVIEW_CHARS);
  if (typeof value.error === "string") return truncatePreview(value.error, MAX_PREVIEW_CHARS);
  return undefined;
}

function truncatePreview(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

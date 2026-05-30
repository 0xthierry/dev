import type { WorkflowMeta } from "../script/parse";

export type WorkflowAgentStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export interface WorkflowActivityUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  totalTokens: number;
  turns: number;
}

export type WorkflowActivityItem = WorkflowAssistantActivityItem | WorkflowToolActivityItem;

export interface WorkflowAssistantActivityItem {
  kind: "assistant";
  status: "running" | "completed";
  text: string;
}

export interface WorkflowToolActivityItem {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  status: "running" | "succeeded" | "failed";
  argsPreview: string;
  outputPreview?: string;
}

export interface WorkflowChildAgentRequest {
  runId: string;
  runDir: string;
  sessionsDir: string;
  cwd: string;
  index: number;
  label: string;
  phase?: string;
  prompt: string;
  schema?: unknown;
  modelRef?: string;
  thinking?: string;
  instructions?: string;
}

export interface WorkflowChildAgentResult {
  label: string;
  status: WorkflowAgentStatus;
  ok: boolean;
  output: string;
  value: unknown;
  outputTruncated: boolean;
  outputArtifactPath?: string;
  stderr: string;
  exitCode: number;
  activity: WorkflowActivityItem[];
  usage: WorkflowActivityUsage;
  sessionId?: string;
  sessionFile?: string;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

export interface WorkflowAgentRunner {
  runAgent: (
    request: WorkflowChildAgentRequest,
    signal: AbortSignal | undefined,
    onProgress?: (result: WorkflowChildAgentResult) => void,
  ) => Promise<WorkflowChildAgentResult>;
}

export interface WorkflowRunArtifacts {
  runId: string;
  runDir: string;
  sessionsDir: string;
  writeScript: (script: string) => Promise<void>;
}

export interface DynamicWorkflowRuntime extends WorkflowAgentRunner {
  createRunArtifacts: (request: { cwd: string; workflowName: string }) => Promise<WorkflowRunArtifacts>;
}

export interface WorkflowAgentSnapshot {
  id: number;
  label: string;
  phase?: string;
  prompt: string;
  status: WorkflowAgentStatus;
  outputPreview?: string;
  errorMessage?: string;
  outputArtifactPath?: string;
  activity: WorkflowActivityItem[];
}

export interface WorkflowSnapshot {
  name: string;
  description: string;
  runId?: string;
  runDir?: string;
  phases: string[];
  currentPhase?: string;
  logs: string[];
  agents: WorkflowAgentSnapshot[];
  agentCount: number;
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  result?: unknown;
  durationMs?: number;
}

export interface WorkflowRunResult<T = unknown> {
  meta: WorkflowMeta;
  result: T;
  logs: string[];
  phases: string[];
  agents: WorkflowChildAgentResult[];
  agentCount: number;
  durationMs: number;
}

export interface WorkflowRunCallbacks {
  onLog?: (message: string) => void;
  onPhase?: (title: string) => void;
  onAgentStart?: (event: { id: number; label: string; phase?: string; prompt: string }) => void;
  onAgentProgress?: (event: { id: number; label: string; phase?: string; result: WorkflowChildAgentResult }) => void;
  onAgentEnd?: (event: { id: number; label: string; phase?: string; result: WorkflowChildAgentResult }) => void;
}

export interface WorkflowRunOptions extends WorkflowRunCallbacks {
  cwd: string;
  runId: string;
  runDir: string;
  sessionsDir: string;
  args?: unknown;
  signal?: AbortSignal;
  concurrency?: number;
  maxAgents?: number;
  tokenBudget?: number | null;
  modelRef?: string;
  thinking?: string;
  agentRunner: WorkflowAgentRunner;
}

export interface WorkflowAgentOptions {
  label?: string;
  phase?: string;
  schema?: unknown;
  model?: string;
  agentType?: string;
  thinking?: string;
}

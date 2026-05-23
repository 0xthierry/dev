import type { AgentArtifactPaths } from "./artifacts";
import type { AgentRunContextMode, AgentRunRequest } from "./invocation";
import type { AgentActivityItem, AgentUsageStats, ChildAgentEventState } from "./json-events";
import { prepareAgentOutput } from "./output";

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed";

export interface AgentRunResult {
  agent: string;
  description?: string;
  task: string;
  context: AgentRunContextMode;
  status: AgentRunStatus;
  ok: boolean;
  exitCode: number;
  finalOutput: string;
  outputTruncated: boolean;
  outputArtifactPath?: string;
  outputArtifactError?: string;
  artifactPaths?: AgentArtifactPaths;
  stderr: string;
  usage: AgentUsageStats;
  activity: AgentActivityItem[];
  agentId?: string;
  sessionFile?: string;
  model?: string;
  thinking?: AgentRunRequest["thinking"];
  stopReason?: string;
  errorMessage?: string;
}

export function buildAgentRunResult(
  request: AgentRunRequest,
  state: ChildAgentEventState,
  exitCode: number,
  stderr: string,
  sessionFile?: string,
  outputArtifactPath?: string,
  outputArtifactError?: string,
  artifactPaths?: AgentArtifactPaths,
): AgentRunResult {
  const status = inferRunStatus(state, exitCode);
  const rawOutput = state.finalOutput || state.errorMessage || stderr.trim() || fallbackOutput(status);
  const prepared = prepareAgentOutput(rawOutput, outputArtifactPath, outputArtifactError);
  const ok = status === "succeeded";

  return {
    agent: request.agent.name,
    description: request.description,
    task: request.task,
    context: request.context,
    status,
    ok,
    exitCode,
    finalOutput: prepared.text,
    outputTruncated: prepared.truncated,
    ...(outputArtifactPath ? { outputArtifactPath } : {}),
    ...(outputArtifactError ? { outputArtifactError } : {}),
    ...(artifactPaths ? { artifactPaths: { ...artifactPaths } } : {}),
    stderr,
    usage: { ...state.usage },
    activity: state.activity.map((item) => ({ ...item })),
    agentId: state.sessionId ?? request.resumeAgentId,
    sessionFile: sessionFile ?? request.resumeSessionFile,
    model: state.model,
    thinking: request.thinking,
    stopReason: state.stopReason,
    errorMessage: state.errorMessage,
  };
}

function inferRunStatus(state: ChildAgentEventState, exitCode: number): AgentRunStatus {
  if (exitCode === -1 && !state.agentEnded) return "running";
  if (state.finalOutput.trim()) return "succeeded";
  if (exitCode === 0 && state.stopReason !== "error" && state.stopReason !== "aborted" && !state.errorMessage) {
    return "succeeded";
  }
  if (state.agentEnded && state.stopReason !== "error" && state.stopReason !== "aborted" && !state.errorMessage) {
    return "succeeded";
  }
  return "failed";
}

function fallbackOutput(status: AgentRunStatus): string {
  if (status === "queued") return "(queued)";
  if (status === "running") return "(running...)";
  return "(no output)";
}

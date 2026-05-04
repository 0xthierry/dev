import type { AgentContextMode } from "../tools/schemas";
import type { AgentRunRequest } from "./invocation";
import type { AgentUsageStats, ChildAgentEventState } from "./json-events";
import { prepareAgentOutput } from "./output";

export interface AgentRunResult {
  agent: string;
  description?: string;
  task: string;
  context: AgentContextMode;
  ok: boolean;
  exitCode: number;
  finalOutput: string;
  outputTruncated: boolean;
  stderr: string;
  usage: AgentUsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}

export function buildAgentRunResult(
  request: AgentRunRequest,
  state: ChildAgentEventState,
  exitCode: number,
  stderr: string,
): AgentRunResult {
  const rawOutput = state.errorMessage || state.finalOutput || stderr.trim() || "(no output)";
  const prepared = prepareAgentOutput(rawOutput);
  const ok = exitCode === 0 && state.stopReason !== "error" && state.stopReason !== "aborted" && !state.errorMessage;

  return {
    agent: request.agent.name,
    description: request.description,
    task: request.task,
    context: request.context,
    ok,
    exitCode,
    finalOutput: prepared.text,
    outputTruncated: prepared.truncated,
    stderr,
    usage: state.usage,
    model: state.model,
    stopReason: state.stopReason,
    errorMessage: state.errorMessage,
  };
}

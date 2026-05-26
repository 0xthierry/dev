import { type PiThinkingLevel, parsePiThinkingLevel } from "../thinking";
import type { AgentContextMode, AgentParams, AgentTaskInput } from "./schemas";

export type PlannedAgentTask = PlannedStartAgentTask | PlannedResumeAgentTask;

export interface PlannedStartAgentTask {
  kind: "start";
  subagentType: string;
  description?: string;
  prompt: string;
  context: AgentContextMode;
  effort?: PiThinkingLevel;
}

export interface PlannedResumeAgentTask {
  kind: "resume";
  agentId: string;
  subagentType?: string;
  description?: string;
  prompt: string;
  context: "resume";
  effort?: PiThinkingLevel;
}

export type AgentExecutionPlan =
  | { mode: "single"; tasks: [PlannedAgentTask] }
  | { mode: "parallel"; tasks: PlannedAgentTask[] };

export type AgentPlanResult = { ok: true; plan: AgentExecutionPlan } | { ok: false; error: string };

export const MAX_PARALLEL_AGENT_TASKS = 8;

export function planAgentInvocation(params: AgentParams): AgentPlanResult {
  const single = readSingleTask(params);
  const parallel = readParallelTasks(params);
  const modeCount = Number(single !== undefined) + Number(parallel !== undefined);

  if (modeCount !== 1) {
    return { ok: false, error: "Provide exactly one agent mode: subagent_type + prompt, or tasks[]." };
  }

  if (single) return { ok: true, plan: { mode: "single", tasks: [single] } };
  if (!parallel) return { ok: false, error: "No agent tasks were provided." };
  if (parallel.length > MAX_PARALLEL_AGENT_TASKS) {
    return {
      ok: false,
      error: `Too many parallel agent tasks (${parallel.length}). Maximum is ${MAX_PARALLEL_AGENT_TASKS}.`,
    };
  }

  return { ok: true, plan: { mode: "parallel", tasks: parallel } };
}

function readSingleTask(params: AgentParams): PlannedAgentTask | undefined {
  const hasStartAgent = typeof params.subagent_type === "string" && params.subagent_type.trim().length > 0;
  const hasResumeAgent = typeof params.agent_id === "string" && params.agent_id.trim().length > 0;
  const hasPrompt = typeof params.prompt === "string" && params.prompt.trim().length > 0;
  if (!hasPrompt || (!hasStartAgent && !hasResumeAgent)) return undefined;

  return normalizeTask(
    {
      subagent_type: params.subagent_type,
      agent_id: params.agent_id,
      description: params.description,
      prompt: params.prompt as string,
      context: params.context,
      effort: params.effort,
    },
    params.context,
    params.effort,
  );
}

function readParallelTasks(params: AgentParams): PlannedAgentTask[] | undefined {
  if (!Array.isArray(params.tasks) || params.tasks.length === 0) return undefined;

  const tasks: PlannedAgentTask[] = [];
  for (const task of params.tasks) {
    const normalized = normalizeTask(task, params.context, params.effort);
    if (!normalized) return undefined;
    tasks.push(normalized);
  }
  return tasks;
}

function normalizeTask(
  task: AgentTaskInput,
  defaultContext?: AgentContextMode,
  defaultEffort?: unknown,
): PlannedAgentTask | undefined {
  if (!task || typeof task !== "object") return undefined;

  const value = task as Record<string, unknown>;
  if (typeof value.prompt !== "string") return undefined;

  const subagentType = typeof value.subagent_type === "string" ? value.subagent_type.trim() : "";
  const agentId = typeof value.agent_id === "string" ? value.agent_id.trim() : "";
  const prompt = value.prompt.trim();
  if (!prompt || (!subagentType && !agentId)) return undefined;

  const description = typeof value.description === "string" ? value.description.trim() || undefined : undefined;
  const effortValue = value.effort ?? defaultEffort;
  const effort = parsePiThinkingLevel(effortValue);
  if (effortValue !== undefined && !effort) return undefined;

  if (agentId) {
    return {
      kind: "resume",
      agentId,
      subagentType: subagentType || undefined,
      description,
      prompt,
      context: "resume",
      ...(effort ? { effort } : {}),
    };
  }

  const context = value.context ?? defaultContext ?? "fresh";
  if (context !== "fresh" && context !== "fork") return undefined;

  return {
    kind: "start",
    subagentType,
    description,
    prompt,
    context,
    ...(effort ? { effort } : {}),
  };
}

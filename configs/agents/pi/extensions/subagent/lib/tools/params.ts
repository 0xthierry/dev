import type { AgentContextMode, AgentParams, AgentTaskInput } from "./schemas";

export interface PlannedAgentTask {
  subagentType: string;
  description?: string;
  prompt: string;
  context: AgentContextMode;
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
    return { ok: false, error: "Provide exactly one Agent mode: subagent_type + prompt, or tasks[]." };
  }

  if (single) return { ok: true, plan: { mode: "single", tasks: [single] } };
  if (!parallel) return { ok: false, error: "No Agent tasks were provided." };
  if (parallel.length > MAX_PARALLEL_AGENT_TASKS) {
    return {
      ok: false,
      error: `Too many parallel Agent tasks (${parallel.length}). Maximum is ${MAX_PARALLEL_AGENT_TASKS}.`,
    };
  }

  return { ok: true, plan: { mode: "parallel", tasks: parallel } };
}

function readSingleTask(params: AgentParams): PlannedAgentTask | undefined {
  if (typeof params.subagent_type !== "string" && typeof params.prompt !== "string") return undefined;
  if (typeof params.subagent_type !== "string" || !params.subagent_type.trim()) return undefined;
  if (typeof params.prompt !== "string" || !params.prompt.trim()) return undefined;

  return normalizeTask(
    {
      subagent_type: params.subagent_type,
      description: params.description,
      prompt: params.prompt,
      context: params.context,
    },
    params.context,
  );
}

function readParallelTasks(params: AgentParams): PlannedAgentTask[] | undefined {
  if (!Array.isArray(params.tasks) || params.tasks.length === 0) return undefined;

  const tasks: PlannedAgentTask[] = [];
  for (const task of params.tasks) {
    const normalized = normalizeTask(task, params.context);
    if (!normalized) return undefined;
    tasks.push(normalized);
  }
  return tasks;
}

function normalizeTask(task: AgentTaskInput, defaultContext?: AgentContextMode): PlannedAgentTask | undefined {
  if (!task || typeof task !== "object") return undefined;

  const value = task as Record<string, unknown>;
  if (typeof value.subagent_type !== "string" || typeof value.prompt !== "string") return undefined;

  const subagentType = value.subagent_type.trim();
  const prompt = value.prompt.trim();
  if (!subagentType || !prompt) return undefined;

  const context = value.context ?? defaultContext ?? "fresh";
  if (context !== "fresh" && context !== "fork") return undefined;

  return {
    subagentType,
    description: typeof value.description === "string" ? value.description.trim() || undefined : undefined,
    prompt,
    context,
  };
}

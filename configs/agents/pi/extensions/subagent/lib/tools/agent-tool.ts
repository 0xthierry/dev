import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";
import { buildAgentRunRequest, type PiThinkingLevel } from "../runner/invocation";
import type { AgentRunResult } from "../runner/run-result";
import { findAgent, type SubagentRuntime } from "../runtime";
import { type PlannedAgentTask, planAgentInvocation } from "./params";
import { renderAgentToolCall, renderAgentToolResult } from "./render";
import { type AgentParams, AgentParamsSchema } from "./schemas";

export interface AgentToolDetails {
  ok: boolean;
  mode: "single" | "parallel";
  agentsDir: string;
  results: AgentRunResult[];
}

const PARALLEL_CONCURRENCY = 4;

export function registerAgentTool(pi: ExtensionAPI, runtime: SubagentRuntime): void {
  pi.registerTool({
    name: "Agent",
    label: "Agent",
    description: [
      "Delegate self-contained work to configured subagents in child Pi sessions.",
      "Use subagent_type + prompt for one task, or tasks[] for independent parallel tasks.",
      "Configured agents are listed in the system prompt when available.",
    ].join(" "),
    promptSnippet: "Delegate self-contained work to a configured subagent child Pi session.",
    promptGuidelines: [
      "Use Agent for focused codebase research, implementation phases, evaluation, review lenses, or other self-contained work that would pollute the main context.",
      "Use Agent.tasks for independent work that can run in parallel, then synthesize the returned results in the main session.",
      "Do not use Agent when a quick direct file read or command in the main session is sufficient.",
    ],
    parameters: AgentParamsSchema,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      return executeAgentTool(pi, runtime, params, signal, onUpdate, ctx);
    },

    renderCall(args, theme) {
      return renderAgentToolCall(args as AgentParams, theme);
    },

    renderResult(result, options, theme) {
      return renderAgentToolResult(result as AgentToolResult<AgentToolDetails>, options, theme);
    },
  });
}

export async function executeAgentTool(
  pi: ExtensionAPI,
  runtime: SubagentRuntime,
  params: AgentParams,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<AgentToolDetails>) => void) | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AgentToolDetails>> {
  const discovery = await runtime.discoverAgents();
  const planResult = planAgentInvocation(params);
  if (!planResult.ok) return errorResult(planResult.error, "single", discovery.agentsDir, []);

  const missing = firstMissingAgent(discovery.agents, planResult.plan.tasks);
  if (missing) {
    const available = discovery.agents.map((agent) => agent.name).join(", ") || "none";
    return errorResult(
      `Unknown subagent: ${missing}. Available agents: ${available}.`,
      planResult.plan.mode,
      discovery.agentsDir,
      [],
    );
  }

  const thinking = readThinkingLevel(pi);
  const emitUpdate = (results: AgentRunResult[]) => {
    onUpdate?.({
      content: [{ type: "text", text: formatProgress(planResult.plan.mode, results) }],
      details: {
        ok: isCompletedSuccess(results),
        mode: planResult.plan.mode,
        agentsDir: discovery.agentsDir,
        results: cloneAgentRunResults(results),
      },
    });
  };

  const runTask = async (
    task: PlannedAgentTask,
    onProgress?: (result: AgentRunResult) => void,
  ): Promise<AgentRunResult> => {
    const agent = findAgent(discovery.agents, task.subagentType);
    if (!agent) throw new Error(`Unknown subagent after validation: ${task.subagentType}`);
    const request = buildAgentRunRequest(
      ctx,
      {
        agent,
        task: task.prompt,
        description: task.description,
        context: task.context,
      },
      thinking,
    );
    return runtime.runAgent(request, signal, onProgress);
  };

  const results =
    planResult.plan.mode === "single"
      ? await runSingleTask(planResult.plan.tasks[0], runTask, emitUpdate)
      : await runParallelTasks(planResult.plan.tasks, PARALLEL_CONCURRENCY, runTask, emitUpdate);

  const ok = results.every((result) => result.ok);
  return {
    content: [{ type: "text", text: formatResults(planResult.plan.mode, results) }],
    details: { ok, mode: planResult.plan.mode, agentsDir: discovery.agentsDir, results },
  };
}

function firstMissingAgent(agents: AgentDefinition[], tasks: PlannedAgentTask): string | undefined;
function firstMissingAgent(agents: AgentDefinition[], tasks: PlannedAgentTask[]): string | undefined;
function firstMissingAgent(
  agents: AgentDefinition[],
  tasks: PlannedAgentTask | PlannedAgentTask[],
): string | undefined {
  const names = new Set(agents.map((agent) => agent.name));
  const taskList = Array.isArray(tasks) ? tasks : [tasks];
  return taskList.find((task) => !names.has(task.subagentType))?.subagentType;
}

function errorResult(
  message: string,
  mode: "single" | "parallel",
  agentsDir: string,
  results: AgentRunResult[],
): AgentToolResult<AgentToolDetails> {
  return {
    content: [{ type: "text", text: message }],
    details: { ok: false, mode, agentsDir, results },
  };
}

function formatResults(mode: "single" | "parallel", results: AgentRunResult[]): string {
  if (results.length === 0) return "No subagent results.";
  if (mode === "single") return results[0].finalOutput;

  const succeeded = results.filter((result) => result.ok).length;
  return [
    `Parallel agents completed: ${succeeded}/${results.length} succeeded.`,
    ...results.map((result) => `\n## ${result.agent}\n${result.finalOutput}`),
  ].join("\n");
}

function formatProgress(mode: "single" | "parallel", results: AgentRunResult[]): string {
  if (results.length === 0) return "No subagent results.";
  if (results.every(isTerminalResult)) return formatResults(mode, results);
  if (mode === "single") return results[0].finalOutput;

  const queued = results.filter((result) => result.status === "queued").length;
  const running = results.filter((result) => result.status === "running").length;
  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const failed = results.filter((result) => result.status === "failed").length;
  return [
    `Parallel agents running: ${succeeded} succeeded, ${failed} failed, ${running} running, ${queued} queued.`,
    ...results.map((result) => `\n## ${result.agent} (${result.status})\n${result.finalOutput}`),
  ].join("\n");
}

async function runSingleTask(
  task: PlannedAgentTask,
  runTask: (task: PlannedAgentTask, onProgress?: (result: AgentRunResult) => void) => Promise<AgentRunResult>,
  emitUpdate: (results: AgentRunResult[]) => void,
): Promise<AgentRunResult[]> {
  emitUpdate([runningAgentRunResult(task)]);
  const result = await runTaskSafely(task, (currentTask) => runTask(currentTask, (progress) => emitUpdate([progress])));
  emitUpdate([result]);
  return [result];
}

async function runTaskSafely(
  task: PlannedAgentTask,
  runTask: (task: PlannedAgentTask) => Promise<AgentRunResult>,
): Promise<AgentRunResult> {
  try {
    return await runTask(task);
  } catch (error) {
    return failedAgentRunResult(task, error);
  }
}

async function runParallelTasks(
  tasks: PlannedAgentTask[],
  concurrency: number,
  runTask: (task: PlannedAgentTask, onProgress?: (result: AgentRunResult) => void) => Promise<AgentRunResult>,
  emitUpdate: (results: AgentRunResult[]) => void,
): Promise<AgentRunResult[]> {
  const results = new Array<AgentRunResult>(tasks.length);
  const currentResults = tasks.map((task) => queuedAgentRunResult(task));
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, tasks.length));

  emitUpdate(currentResults);

  await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const task = tasks[currentIndex];
        currentResults[currentIndex] = runningAgentRunResult(task);
        emitUpdate(currentResults);

        const result = await runTaskSafely(task, (currentTask) =>
          runTask(currentTask, (progress) => {
            currentResults[currentIndex] = progress;
            emitUpdate(currentResults);
          }),
        );
        results[currentIndex] = result;
        currentResults[currentIndex] = result;
        emitUpdate(currentResults);
      }
    }),
  );

  return tasks.map(
    (task, index) => results[index] ?? failedAgentRunResult(task, "Agent worker stopped before this task completed."),
  );
}

function queuedAgentRunResult(task: PlannedAgentTask): AgentRunResult {
  return baseAgentRunResult(task, "queued", "(queued)");
}

function runningAgentRunResult(task: PlannedAgentTask): AgentRunResult {
  return baseAgentRunResult(task, "running", "(starting child Pi...)");
}

function failedAgentRunResult(task: PlannedAgentTask, error: unknown): AgentRunResult {
  const message = errorMessage(error);
  return {
    ...baseAgentRunResult(task, "failed", `Agent ${task.subagentType} failed: ${message}`),
    exitCode: 1,
    stderr: message,
    stopReason: "error",
    errorMessage: message,
  };
}

function baseAgentRunResult(
  task: PlannedAgentTask,
  status: AgentRunResult["status"],
  finalOutput: string,
): AgentRunResult {
  return {
    agent: task.subagentType,
    description: task.description,
    task: task.prompt,
    context: task.context,
    status,
    ok: status === "succeeded",
    exitCode: status === "queued" || status === "running" ? -1 : 0,
    finalOutput,
    outputTruncated: false,
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 0 },
    activity: [],
  };
}

function cloneAgentRunResults(results: AgentRunResult[]): AgentRunResult[] {
  return results.map((result) => ({
    ...result,
    usage: { ...result.usage },
    activity: result.activity.map((item) => ({ ...item })),
  }));
}

function isCompletedSuccess(results: AgentRunResult[]): boolean {
  return results.length > 0 && results.every((result) => result.status === "succeeded" && result.ok);
}

function isTerminalResult(result: AgentRunResult): boolean {
  return result.status === "succeeded" || result.status === "failed";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown subagent failure";
}

function readThinkingLevel(pi: ExtensionAPI): PiThinkingLevel {
  return pi.getThinkingLevel?.() ?? "medium";
}

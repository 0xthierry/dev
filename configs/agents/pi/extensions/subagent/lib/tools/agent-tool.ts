import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";
import { buildAgentRunRequest } from "../runner/invocation";
import type { AgentRunResult } from "../runner/run-result";
import type { SubagentRuntime } from "../runtime";
import { findAgentSessionFileById, getProjectAgentSessionDir } from "../sessions/paths";
import type { AgentSessionRecord } from "../sessions/registry";
import { findAgentSessionRecord, restoreAgentSessionRecords } from "../sessions/registry";
import { type PiThinkingLevel, parsePiThinkingLevel } from "../thinking";
import { MAX_PARALLEL_AGENT_TASKS, type PlannedAgentTask, planAgentInvocation, prepareAgentArguments } from "./params";
import { renderAgentToolCall, renderAgentToolResult } from "./render";
import { type AgentParams, AgentParamsSchema } from "./schemas";

export interface AgentToolDetails {
  ok: boolean;
  mode: "single" | "parallel";
  agentsDir: string;
  results: AgentRunResult[];
}

// Keep accepted batch size and actual child process concurrency aligned so tasks do not queue below the documented limit.
const PARALLEL_CONCURRENCY = MAX_PARALLEL_AGENT_TASKS;

interface ResolvedAgentTask {
  kind: PlannedAgentTask["kind"];
  subagentType: string;
  agentId?: string;
  description?: string;
  prompt: string;
  context: PlannedAgentTask["context"];
  agentDefinition: AgentDefinition;
  thinking: PiThinkingLevel;
  resumeSessionFile?: string;
}

export function registerAgentTool(pi: ExtensionAPI, runtime: SubagentRuntime): void {
  pi.registerTool({
    name: "agent",
    label: "agent",
    description: [
      "Spawn or resume a subagent for a well-scoped task.",
      "Use subagent_type + prompt to start one task, agent_id + prompt to resume, or tasks[] for independent parallel tasks.",
      "Configured and built-in agents are listed in the system prompt when available.",
      "A trusted repo can override each agent's provider, model, and effort with pi-subagent.json, and may lock effort against tool-call overrides.",
      "Otherwise, child agents inherit the current model and thinking level unless the tool call or agent definition sets effort.",
    ].join(" "),
    promptSnippet: "Spawn or resume a focused child subagent for a well-scoped task.",
    promptGuidelines: [
      "Do not use the agent tool when a quick direct file read or command in the main session is sufficient.",
      "Before delegating, decide what immediate critical-path work you should do locally; do not hand off urgent blocking work when your next step depends on the result.",
      "Delegate concrete, bounded tasks that materially advance the main task and can run independently; avoid duplicating work between the parent and child agents.",
      "Use agent.agent_id with a follow-up prompt to resume a previous child session when the prior agent result returned an agent_id.",
      "Use agent.tasks for multiple independent tasks that can run in parallel, then synthesize the returned results in the main session.",
      "For coding subtasks, give each child a disjoint write scope and tell it to edit files directly, list changed paths, and report validation.",
      "Prompt child agents with a compact contract: goal, context/evidence, success criteria, hard constraints, validation, expected output, and stop rules.",
    ],
    parameters: AgentParamsSchema,

    prepareArguments(args) {
      return prepareAgentArguments(args) as AgentParams;
    },

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
  const discovery = await runtime.discoverAgents({
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
  });
  const planResult = planAgentInvocation(params);
  if (!planResult.ok) return errorResult(planResult.error, "single", discovery.agentsDir, []);

  const taskResult = await resolveAgentTasks(discovery.agents, planResult.plan.tasks, readThinkingLevel(pi), ctx);
  if (!taskResult.ok) return errorResult(taskResult.error, planResult.plan.mode, discovery.agentsDir, []);

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
    task: ResolvedAgentTask,
    onProgress?: (result: AgentRunResult) => void,
  ): Promise<AgentRunResult> => {
    const request = buildAgentRunRequest(
      ctx,
      {
        agent: task.agentDefinition,
        task: task.prompt,
        description: task.description,
        context: task.context,
        resumeAgentId: task.agentId,
        resumeSessionFile: task.resumeSessionFile,
      },
      task.thinking,
    );
    return runtime.runAgent(request, signal, onProgress);
  };

  const results =
    planResult.plan.mode === "single"
      ? await runSingleTask(taskResult.tasks[0], runTask, emitUpdate)
      : await runParallelTasks(taskResult.tasks, PARALLEL_CONCURRENCY, runTask, emitUpdate);

  const ok = results.every((result) => result.ok);
  return {
    content: [{ type: "text", text: formatResults(planResult.plan.mode, results) }],
    details: { ok, mode: planResult.plan.mode, agentsDir: discovery.agentsDir, results },
  };
}

type ResolveAgentTasksResult = { ok: true; tasks: ResolvedAgentTask[] } | { ok: false; error: string };

async function resolveAgentTasks(
  agents: AgentDefinition[],
  tasks: PlannedAgentTask[],
  parentThinking: PiThinkingLevel,
  ctx: ExtensionContext,
): Promise<ResolveAgentTasksResult> {
  const agentsByName = new Map(agents.map((agent) => [agent.name, agent]));
  const sessionRecords = restoreAgentSessionRecords(ctx.sessionManager.getBranch());
  const agentSessionDir = getProjectAgentSessionDir(ctx.cwd);
  const resolved: ResolvedAgentTask[] = [];

  for (const task of tasks) {
    const result =
      task.kind === "start"
        ? resolveStartTask(task, agentsByName, parentThinking, agents)
        : await resolveResumeTask(task, agentsByName, parentThinking, sessionRecords, agentSessionDir, agents);
    if (!result.ok) return result;
    resolved.push(result.task);
  }

  return { ok: true, tasks: resolved };
}

function resolveStartTask(
  task: Extract<PlannedAgentTask, { kind: "start" }>,
  agentsByName: Map<string, AgentDefinition>,
  parentThinking: PiThinkingLevel,
  agents: AgentDefinition[],
): { ok: true; task: ResolvedAgentTask } | { ok: false; error: string } {
  const agentDefinition = agentsByName.get(task.subagentType);
  if (!agentDefinition) return { ok: false, error: unknownAgentMessage(task.subagentType, agents) };

  return {
    ok: true,
    task: {
      kind: "start",
      subagentType: task.subagentType,
      description: task.description,
      prompt: task.prompt,
      context: task.context,
      agentDefinition,
      thinking: resolveAgentThinking(task.effort, agentDefinition, parentThinking),
    },
  };
}

async function resolveResumeTask(
  task: Extract<PlannedAgentTask, { kind: "resume" }>,
  agentsByName: Map<string, AgentDefinition>,
  parentThinking: PiThinkingLevel,
  sessionRecords: AgentSessionRecord[],
  agentSessionDir: string,
  agents: AgentDefinition[],
): Promise<{ ok: true; task: ResolvedAgentTask } | { ok: false; error: string }> {
  const restored = findAgentSessionRecord(sessionRecords, task.agentId);
  if (restored.ok) {
    return resolveResumeTaskFromRecord(task, restored.record, agentsByName, parentThinking, agents);
  }
  if (restored.reason === "ambiguous") {
    return { ok: false, error: ambiguousAgentSessionMessage(task.agentId, restored.matches) };
  }

  const fileLookup = await findAgentSessionFileById(agentSessionDir, task.agentId);
  if (!fileLookup.ok) {
    if (fileLookup.reason === "ambiguous") {
      return { ok: false, error: ambiguousAgentSessionMessage(task.agentId, fileLookup.matches) };
    }
    return { ok: false, error: unknownAgentSessionMessage(task.agentId, agentSessionDir) };
  }
  if (!task.subagentType) {
    return {
      ok: false,
      error: `agent session ${fileLookup.match.sessionId} exists on disk, but this parent session has no record of its subagent type. Provide subagent_type with agent_id to resume it.`,
    };
  }

  return resolveResumeTaskFromRecord(
    task,
    { agentId: fileLookup.match.sessionId, agent: task.subagentType, sessionFile: fileLookup.match.sessionFile },
    agentsByName,
    parentThinking,
    agents,
  );
}

function resolveResumeTaskFromRecord(
  task: Extract<PlannedAgentTask, { kind: "resume" }>,
  record: AgentSessionRecord,
  agentsByName: Map<string, AgentDefinition>,
  parentThinking: PiThinkingLevel,
  agents: AgentDefinition[],
): { ok: true; task: ResolvedAgentTask } | { ok: false; error: string } {
  if (task.subagentType && task.subagentType !== record.agent) {
    return {
      ok: false,
      error: `agent session ${record.agentId} belongs to subagent ${record.agent}, not ${task.subagentType}.`,
    };
  }

  const agentDefinition = agentsByName.get(record.agent);
  if (!agentDefinition) return { ok: false, error: unknownAgentMessage(record.agent, agents) };

  return {
    ok: true,
    task: {
      kind: "resume",
      subagentType: record.agent,
      agentId: record.agentId,
      description: task.description,
      prompt: task.prompt,
      context: "resume",
      agentDefinition,
      thinking: resolveAgentThinking(task.effort, agentDefinition, parentThinking),
      resumeSessionFile: record.sessionFile,
    },
  };
}

function resolveAgentThinking(
  requestedEffort: PiThinkingLevel | undefined,
  agent: AgentDefinition,
  parentThinking: PiThinkingLevel,
): PiThinkingLevel {
  if (agent.allowEffortOverride === false) return agent.effort ?? parentThinking;
  return requestedEffort ?? agent.effort ?? parentThinking;
}

function unknownAgentMessage(agentName: string, agents: AgentDefinition[]): string {
  const available = agents.map((agent) => agent.name).join(", ") || "none";
  return `Unknown subagent: ${agentName}. Available agents: ${available}.`;
}

function unknownAgentSessionMessage(agentId: string, agentSessionDir: string): string {
  return `Unknown agent session: ${agentId}. Use an agent_id returned by an earlier agent result, or resume with subagent_type after confirming the session exists in ${agentSessionDir}.`;
}

function ambiguousAgentSessionMessage(
  agentId: string,
  matches: Array<{ agentId?: string; sessionId?: string }>,
): string {
  const ids = matches
    .map((match) => match.agentId ?? match.sessionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return `agent session id "${agentId}" is ambiguous. Matches: ${ids.join(", ") || "multiple sessions"}.`;
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
  if (mode === "single") return formatSingleAgentOutput(results[0]);

  const succeeded = results.filter((result) => result.ok).length;
  return [
    `Parallel agents completed: ${succeeded}/${results.length} succeeded.`,
    ...results.map((result) => `\n## ${formatAgentResultHeading(result)}\n${result.finalOutput}`),
  ].join("\n");
}

function formatSingleAgentOutput(result: AgentRunResult): string {
  const idLine = result.agentId ? `agent_id: ${result.agentId}\n` : "";
  return `${idLine}${result.finalOutput}`;
}

function formatAgentResultHeading(result: AgentRunResult): string {
  return result.agentId ? `${result.agent} (agent_id: ${result.agentId})` : result.agent;
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
    ...results.map((result) => `\n## ${formatAgentResultHeading(result)} (${result.status})\n${result.finalOutput}`),
  ].join("\n");
}

async function runSingleTask(
  task: ResolvedAgentTask,
  runTask: (task: ResolvedAgentTask, onProgress?: (result: AgentRunResult) => void) => Promise<AgentRunResult>,
  emitUpdate: (results: AgentRunResult[]) => void,
): Promise<AgentRunResult[]> {
  emitUpdate([runningAgentRunResult(task)]);
  const result = await runTaskSafely(task, (currentTask) => runTask(currentTask, (progress) => emitUpdate([progress])));
  emitUpdate([result]);
  return [result];
}

async function runTaskSafely(
  task: ResolvedAgentTask,
  runTask: (task: ResolvedAgentTask) => Promise<AgentRunResult>,
): Promise<AgentRunResult> {
  try {
    return await runTask(task);
  } catch (error) {
    return failedAgentRunResult(task, error);
  }
}

async function runParallelTasks(
  tasks: ResolvedAgentTask[],
  concurrency: number,
  runTask: (task: ResolvedAgentTask, onProgress?: (result: AgentRunResult) => void) => Promise<AgentRunResult>,
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
    (task, index) => results[index] ?? failedAgentRunResult(task, "agent worker stopped before this task completed."),
  );
}

function queuedAgentRunResult(task: ResolvedAgentTask): AgentRunResult {
  return baseAgentRunResult(task, "queued", "(queued)");
}

function runningAgentRunResult(task: ResolvedAgentTask): AgentRunResult {
  return baseAgentRunResult(task, "running", "(starting child Pi...)");
}

function failedAgentRunResult(task: ResolvedAgentTask, error: unknown): AgentRunResult {
  const message = errorMessage(error);
  return {
    ...baseAgentRunResult(task, "failed", `agent ${task.subagentType} failed: ${message}`),
    exitCode: 1,
    stderr: message,
    stopReason: "error",
    errorMessage: message,
  };
}

function baseAgentRunResult(
  task: ResolvedAgentTask,
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
    durationMs: 0,
    finalOutput,
    outputTruncated: false,
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 0 },
    activity: [],
    agentId: task.agentId,
    sessionFile: task.resumeSessionFile,
    thinking: task.thinking,
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
  return parsePiThinkingLevel(pi.getThinkingLevel?.()) ?? "medium";
}

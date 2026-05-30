import {
  type AgentToolResult,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  formatSize,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { runDynamicWorkflow } from "../runtime/execute";
import type { DynamicWorkflowRuntime, WorkflowChildAgentResult, WorkflowSnapshot } from "../runtime/types";
import { parseWorkflowScript } from "../script/parse";
import {
  createWorkflowSnapshot,
  preview,
  recomputeWorkflowSnapshot,
  renderWorkflowToolCall,
  renderWorkflowToolResult,
} from "./render";

export const WorkflowToolSchema = Type.Object({
  script: Type.String({
    description: [
      "Required raw JavaScript workflow script, with no Markdown fences.",
      "First statement: export const meta = { name: 'short_snake_case', description: 'non-empty description', phases: [{ title: 'Phase' }] }.",
      "Use phase('Name'), agent(prompt, opts), parallel(arrayOfFunctions), pipeline(items, ...stages), log(message), args, cwd, process.cwd(), and budget.",
      "Every workflow must call agent() at least once.",
    ].join(" "),
  }),
  args: Type.Optional(
    Type.Any({ description: "Optional JSON value exposed to the workflow script as global `args`." }),
  ),
});

export type WorkflowToolInput = Static<typeof WorkflowToolSchema>;

export interface WorkflowToolDetails {
  ok: boolean;
  runId: string;
  runDir: string;
  snapshot: WorkflowSnapshot;
  result?: unknown;
}

export function registerWorkflowTool(pi: ExtensionAPI, runtime: DynamicWorkflowRuntime): void {
  pi.registerTool({
    name: "workflow",
    label: "workflow",
    description: [
      "Execute a deterministic JavaScript workflow that orchestrates focused child Pi agents with agent(), parallel(), and pipeline().",
      "The script must start with export const meta = { name, description, phases? } and must call agent() at least once.",
    ].join(" "),
    promptSnippet:
      "Run a deterministic JavaScript workflow for explicit fan-out/fan-in multi-agent orchestration requests.",
    promptGuidelines: [
      "Use workflow only when the user explicitly asks for a workflow, workflows, fan-out, or multi-agent orchestration.",
      "For workflow, pass one raw JavaScript string in the script parameter; do not include Markdown fences or prose around the script.",
      "For workflow, the script's first statement must be `export const meta = { name: 'short_snake_case', description: 'non-empty human description', phases: [{ title: 'Phase name' }] }`.",
      "For workflow, write plain JavaScript after the meta export. Do not use TypeScript syntax, imports, require(), fs, network APIs, Date, Math.random(), eval, Function, or globalThis.",
      "For workflow, available globals are agent(prompt, opts), parallel(thunks), pipeline(items, ...stages), phase(title), log(message), args, cwd, process.cwd(), and budget.",
      "For workflow, every workflow must call agent() at least once; do not use workflow only to declare phases or return static data.",
      "For workflow, parallel() takes functions, not promises: use `await parallel(items.map(item => () => agent('...', { label: '...' })))`.",
      "For workflow, pipeline(items, ...stages) runs each item through stages sequentially while different items may run concurrently.",
      "For workflow, every agent() call should include a unique short label option, 2-5 words, such as { label: 'repo inventory' }.",
      "For workflow, failed agent(), parallel(), or pipeline() branches return null and log the failure unless the workflow is aborted; check for nulls before synthesizing conclusions.",
      "For workflow, include a final synthesis/assertion agent when combining multiple child agent results; return compact JSON-serializable data.",
      "For workflow, if agent() needs machine-readable output, pass plain JSON Schema via opts.schema; the child must finish with structured_output.",
      "For workflow, do not assume child agents share the parent assistant's code context; include enough task context and relevant paths in each child prompt.",
    ],
    parameters: WorkflowToolSchema,
    prepareArguments(args) {
      return normalizeWorkflowToolArgs(args);
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = normalizeWorkflowToolArgs(params);
      const parsed = parseWorkflowScript(input.script);
      const artifacts = await runtime.createRunArtifacts({ cwd: ctx.cwd, workflowName: parsed.meta.name });
      await artifacts.writeScript(input.script);

      let snapshot = createWorkflowSnapshot(parsed.meta, { runId: artifacts.runId, runDir: artifacts.runDir });
      const update = () => {
        snapshot = recomputeWorkflowSnapshot(snapshot);
        onUpdate?.({
          content: [{ type: "text", text: renderSnapshotForTool(snapshot, false) }],
          details: { ok: false, runId: artifacts.runId, runDir: artifacts.runDir, snapshot },
        });
      };

      try {
        const result = await runDynamicWorkflow(input.script, {
          cwd: ctx.cwd,
          runId: artifacts.runId,
          runDir: artifacts.runDir,
          sessionsDir: artifacts.sessionsDir,
          args: input.args,
          signal,
          modelRef: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
          thinking: pi.getThinkingLevel?.(),
          agentRunner: runtime,
          onLog(message) {
            snapshot.logs.push(message);
            update();
          },
          onPhase(title) {
            snapshot.currentPhase = title;
            if (!snapshot.phases.includes(title)) snapshot.phases.push(title);
            update();
          },
          onAgentStart(event) {
            snapshot.agents.push({
              id: event.id,
              label: event.label,
              phase: event.phase,
              prompt: event.prompt,
              status: "running",
              activity: [],
            });
            update();
          },
          onAgentProgress(event) {
            updateAgent(snapshot, event.id, event.result);
            update();
          },
          onAgentEnd(event) {
            updateAgent(snapshot, event.id, event.result);
            update();
          },
        });

        if (result.agentCount === 0) {
          throw new Error("workflow scripts must call agent() at least once; this workflow did not run child agents");
        }

        snapshot.result = result.result;
        snapshot.durationMs = result.durationMs;
        snapshot = recomputeWorkflowSnapshot(snapshot);
        const ok = result.agents.every((agent) => agent.ok);

        return {
          content: [
            {
              type: "text" as const,
              text: formatFinalToolContent(result.meta.name, result.agentCount, result.result, artifacts.runDir),
            },
          ],
          details: { ok, runId: artifacts.runId, runDir: artifacts.runDir, snapshot, result: result.result },
        };
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) markRunningAgentsSkipped(snapshot);
        snapshot = recomputeWorkflowSnapshot(snapshot);
        onUpdate?.({
          content: [{ type: "text", text: renderSnapshotForTool(snapshot, true) }],
          details: { ok: false, runId: artifacts.runId, runDir: artifacts.runDir, snapshot },
        });
        throw error;
      }
    },
    renderCall(args, theme) {
      return renderWorkflowToolCall(args as WorkflowToolInput, theme);
    },
    renderResult(result, options, theme) {
      return renderWorkflowToolResult(result as unknown as AgentToolResult<WorkflowToolDetails>, options, theme);
    },
  });
}

export function normalizeWorkflowToolArgs(args: unknown): WorkflowToolInput {
  if (!args || typeof args !== "object") throw new Error("workflow requires an object argument with a script string");
  const value = args as Record<string, unknown>;
  if (typeof value.script !== "string") throw new Error("workflow requires `script` to be a string");
  return { ...value, script: normalizeWorkflowScript(value.script) } as WorkflowToolInput;
}

export function normalizeWorkflowScript(script: string): string {
  let text = script.trim();
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();
  return text;
}

function updateAgent(snapshot: WorkflowSnapshot, id: number, result: WorkflowChildAgentResult): void {
  const agent = snapshot.agents.find((item) => item.id === id);
  if (!agent) return;
  agent.status = result.status;
  agent.outputPreview = preview(result.value ?? result.output);
  agent.errorMessage = result.errorMessage;
  agent.outputArtifactPath = result.outputArtifactPath;
  agent.activity = result.activity.map((item) => ({ ...item }));
}

function markRunningAgentsSkipped(snapshot: WorkflowSnapshot): void {
  for (const agent of snapshot.agents) {
    if (agent.status !== "running") continue;
    agent.status = "skipped";
    agent.errorMessage = "aborted";
  }
}

function formatFinalToolContent(name: string, agentCount: number, result: unknown, runDir: string): string {
  const resultText = JSON.stringify(result, null, 2);
  const truncation = truncateTail(resultText, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  const notice = truncation.truncated
    ? `\n\n[Result truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
        truncation.outputBytes,
      )} of ${formatSize(truncation.totalBytes)}). Full run artifacts: ${runDir}]`
    : `\n\nRun artifacts: ${runDir}`;
  return `Workflow ${name} completed with ${agentCount} agent(s).\n\nResult:\n${truncation.content}${notice}`;
}

function renderSnapshotForTool(snapshot: WorkflowSnapshot, completed: boolean): string {
  const state = completed ? "Workflow completed" : "Workflow running";
  return `${state}\n◆ Workflow: ${snapshot.name} (${snapshot.succeededCount}/${snapshot.agentCount} done)`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && /\babort(?:ed)?\b/i.test(error.message);
}

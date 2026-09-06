import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ORCHESTRATION_GUIDANCE } from "../agents/orchestration-guidance";
import type { ArtifactPage } from "../artifacts/artifacts";
import { prepareAggregatePreview, prepareArtifactPageForModel } from "../artifacts/output";
import { CHILD_IPC_SOCKET_ENV, CHILD_IPC_TOKEN_ENV } from "../ipc/authentication";
import { createIpcClient, IpcClientError } from "../ipc/client";
import type { IpcOperation, IpcOperationPayload } from "../ipc/protocol";
import { createEnvironmentRedactor } from "../security/redaction";
import { SUBAGENT_MODEL_GUIDANCE } from "../tools/model-guidance";
import { renderAgentCall, renderAgentResult } from "../tools/render";
import {
  type AgentWaitParams,
  AgentWaitParamsSchema,
  type FollowupParams,
  FollowupParamsSchema,
  ListParamsSchema,
  type SendParams,
  SendParamsSchema,
  type SpawnParams,
  SpawnParamsSchema,
  type TargetParams,
  TargetParamsSchema,
} from "../tools/schemas";

export const CHILD_AGENT_TOOL_NAMES = [
  "agent_spawn",
  "agent_send",
  "agent_followup",
  "agent_wait",
  "agent_interrupt",
  "agent_list",
  "agent_close",
] as const;

export const CHILD_COLLABORATION_GUIDANCE = `You are a persistent child working for a direct parent orchestration session.
The collaboration tools use the root session's shared scheduler and durable mailboxes; nested work shares the same filesystem and current working directory.
Delegate only bounded, disjoint work. Communicate deliberately with exact agent IDs or canonical paths, and wait only when a result becomes a dependency.
Your final answer is delivered to your direct parent. Do not expose credentials or control-channel metadata.

${ORCHESTRATION_GUIDANCE}`;

export interface ChildProxyRuntime {
  request<Operation extends IpcOperation>(
    operation: Operation,
    payload: IpcOperationPayload[Operation],
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): void;
}

interface ChildToolDetails {
  ok: boolean;
  operation: IpcOperation;
  result?: unknown;
  error?: { kind: string; message: string };
}

export function registerChildRuntime(pi: ExtensionAPI, runtime: ChildProxyRuntime): void {
  pi.registerTool({
    name: "agent_spawn",
    label: "spawn agent",
    description:
      "Start a persistent agent for a concrete, bounded task alongside useful local work. Returns its ID, canonical path, and effective settings. Running means the prompt was accepted; queued means startup is waiting for capacity. Neither means completion; the final result is delivered to you.\n\n" +
      SUBAGENT_MODEL_GUIDANCE,
    promptSnippet: "Delegate a bounded task to a persistent agent while you continue useful local work.",
    promptGuidelines: [
      "agent_spawn: Give a self-contained task with disjoint ownership, constraints, validation, and expected output.",
      "agent_spawn: No conversation history is copied by default; context.fork_turns all copies the saved parent context.",
      "agent_spawn: Inspect returned effective settings; the root supervisor enforces execution, depth, and shared capacity limits.",
    ],
    parameters: SpawnParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_spawn", params, signal),
    renderCall: (args, theme) => {
      const params = args as SpawnParams | undefined;
      return renderAgentCall("agent_spawn", params?.task_name, theme, params?.prompt);
    },
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_send",
    label: "send to agent",
    description:
      "Send a message to a visible parent, child, or sibling. Steers running work or saves the message for a resumable agent; does not start a task.",
    promptSnippet: "Steer an agent or save a message without starting a task.",
    promptGuidelines: ["agent_send: Use agent_followup for a new task or execution change."],
    parameters: SendParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_send", params, signal),
    renderCall: (args, theme) => {
      const params = args as SendParams | undefined;
      return renderAgentCall("agent_send", params?.target, theme, params?.message);
    },
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_followup",
    label: "follow up agent",
    description:
      "Give an existing visible agent its next task while retaining context. Idle starts, active queues, and unloaded resumes from its saved session. Execution changes apply at the next task boundary; omitting execution keeps current settings. For model selection, follow the guidance in agent_spawn.",
    promptSnippet: "Continue with an existing agent when its prior context helps the next task.",
    promptGuidelines: [
      "agent_followup: Reuse an agent when its prior context helps; inspect returned effective settings after requesting changes.",
    ],
    parameters: FollowupParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_followup", params, signal),
    renderCall: (args, theme) => {
      const params = args as FollowupParams | undefined;
      return renderAgentCall("agent_followup", params?.target, theme, params?.message);
    },
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_wait",
    label: "wait for agents",
    description:
      "Wait for visible agents' current tasks: all returns when every task settles, any when one settles. Timeout or caller abort stops only the wait, not the agents. Also reads paginated completion artifacts from direct children.",
    promptSnippet: "Wait when blocked on agents, or read a completion artifact page.",
    promptGuidelines: [
      "agent_wait: Wait only when blocked and no independent work remains; do not loop short waits or poll agent_list.",
      "agent_wait: Use operation=read_artifact with an opaque artifact_ref from a direct child; sibling and unrelated artifacts are denied. Page with returned nextCursor until eof, never a host path.",
    ],
    parameters: AgentWaitParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_wait", params, signal),
    renderCall: (args, theme) => {
      const params = args as AgentWaitParams | undefined;
      if (params?.operation === "read_artifact") return renderAgentCall("agent_wait", "artifact page", theme);
      const count = params?.targets.length;
      return renderAgentCall(
        "agent_wait",
        count === undefined ? undefined : `${count} target${count === 1 ? "" : "s"}`,
        theme,
        params?.targets.join(", "),
      );
    },
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_interrupt",
    label: "interrupt agent",
    description:
      "Stop a visible agent's active work while preserving its session for later follow-up. Safe to repeat; once issued, cleanup finishes even if the caller aborts.",
    promptSnippet: "Stop active work but keep the agent's session.",
    promptGuidelines: [
      "agent_interrupt: Preserve the agent for later agent_followup; use agent_close only for permanent shutdown.",
    ],
    parameters: TargetParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_interrupt", params, signal),
    renderCall: (args, theme) => renderAgentCall("agent_interrupt", (args as TargetParams | undefined)?.target, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_list",
    label: "list agents",
    description:
      "Inspect visible agents' IDs, canonical paths, statuses, current tasks, and effective provider/model/effort. Returns a compact snapshot without prompts or credentials.",
    promptSnippet: "Inspect agents' statuses, tasks, and effective settings.",
    promptGuidelines: ["agent_list: Inspect when needed; do not poll for completion. Use agent_wait when blocked."],
    parameters: ListParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_list", params, signal),
    renderCall: (_args, theme) => renderAgentCall("agent_list", undefined, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_close",
    label: "close agent",
    description:
      "Permanently close a visible agent, stop its active work, and release capacity. Safe to repeat; a closed agent cannot be resumed.",
    promptSnippet: "Permanently close an agent and release capacity.",
    promptGuidelines: [
      "agent_close: Closing is permanent; use agent_interrupt instead when later follow-up may be needed.",
    ],
    parameters: TargetParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_close", params, signal),
    renderCall: (args, theme) => renderAgentCall("agent_close", (args as TargetParams | undefined)?.target, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${CHILD_COLLABORATION_GUIDANCE}`,
  }));
  pi.on("session_shutdown", () => runtime.close());
}

export function createEnvironmentChildRuntime(environment: NodeJS.ProcessEnv = process.env): ChildProxyRuntime {
  const socketPath = environment[CHILD_IPC_SOCKET_ENV];
  const token = environment[CHILD_IPC_TOKEN_ENV];
  delete environment[CHILD_IPC_SOCKET_ENV];
  delete environment[CHILD_IPC_TOKEN_ENV];
  if (!socketPath || !token) return unavailableRuntime();
  const redact = createEnvironmentRedactor(environment, [socketPath, token]);
  return createIpcClient({ socketPath, token, redact });
}

export default function childRuntimeExtension(pi: ExtensionAPI): void {
  registerChildRuntime(pi, createEnvironmentChildRuntime());
}

async function proxyTool<Operation extends IpcOperation>(
  runtime: ChildProxyRuntime,
  operation: Operation,
  payload: IpcOperationPayload[Operation],
  signal?: AbortSignal,
): Promise<AgentToolResult<ChildToolDetails>> {
  try {
    const result = await runtime.request(operation, payload, signal);
    const waitPayload = operation === "agent_wait" ? (payload as IpcOperationPayload["agent_wait"]) : undefined;
    if (waitPayload?.operation === "read_artifact") {
      const prepared = prepareArtifactPageForModel(result as ArtifactPage);
      return {
        content: [{ type: "text", text: prepared.text }],
        details: { ok: true, operation, result: prepared.page },
      };
    }
    const rendered = prepareAggregatePreview(JSON.stringify(result, null, 2));
    return {
      content: [{ type: "text", text: rendered.text }],
      details: { ok: true, operation, result },
    };
  } catch (error) {
    const formatted = childError(error);
    return {
      content: [{ type: "text", text: `${operation} failed: ${formatted.message}` }],
      details: { ok: false, operation, error: formatted },
    };
  }
}

function unavailableRuntime(): ChildProxyRuntime {
  return {
    request: async () => {
      throw new IpcClientError("closed", "Collaboration unavailable");
    },
    close() {},
  };
}

function childError(error: unknown): { kind: string; message: string } {
  if (error instanceof IpcClientError) {
    return {
      kind: error.remoteKind ?? error.kind,
      message: prepareAggregatePreview(error.message).text,
    };
  }
  if (error instanceof DOMException && error.name === "AbortError")
    return { kind: "aborted", message: "Operation aborted" };
  return { kind: "unexpected", message: "Collaboration request failed" };
}

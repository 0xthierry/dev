import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ArtifactPage } from "../artifacts/artifacts";
import { prepareAggregatePreview, prepareArtifactPageForModel } from "../artifacts/output";
import { CHILD_IPC_SOCKET_ENV, CHILD_IPC_TOKEN_ENV } from "../ipc/authentication";
import { createIpcClient, IpcClientError } from "../ipc/client";
import type { IpcOperation, IpcOperationPayload } from "../ipc/protocol";
import { createEnvironmentRedactor } from "../security/redaction";
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
Your final answer is delivered to your direct parent. Do not expose credentials or control-channel metadata.`;

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
      "Start one persistent nested child below this authenticated caller. Returns after central supervisor admission: running means child prompt acceptance, while queued means capacity delayed startup and acceptance. Neither means completion.",
    promptSnippet: "Start one nested child; running is prompt-accepted, while queued is admitted but not started.",
    promptGuidelines: [
      "agent_spawn: Delegate only concrete bounded work with a self-contained contract and disjoint ownership.",
      "agent_spawn: Running means the child accepted its prompt; queued means only supervisor admission while startup waits for shared capacity.",
      "agent_spawn: Neither result means completion; use agent_wait only when settlement becomes a dependency.",
      "agent_spawn: Provider and model must be supplied together; execution resolution and nested depth/capacity policy are enforced by the root supervisor.",
    ],
    parameters: SpawnParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_spawn", params, signal),
    renderCall: (args, theme) => renderAgentCall("agent_spawn", (args as SpawnParams | undefined)?.task_name, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_send",
    label: "send to agent",
    description:
      "Send bounded communication to an exact visible parent, child, or sibling. Running work is steered; resumable idle work receives durable mail; no assignment starts.",
    promptSnippet: "Steer visible running work or queue durable mail without starting an assignment.",
    promptGuidelines: [
      "agent_send: Use an exact visible ID or canonical path; caller identity and visibility are derived by the root supervisor.",
      "agent_send: Use agent_followup for assigned work because agent_send communication never starts a model turn.",
    ],
    parameters: SendParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_send", params, signal),
    renderCall: (args, theme) => renderAgentCall("agent_send", (args as SendParams | undefined)?.target, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_followup",
    label: "follow up agent",
    description:
      "Assign retained-session follow-up work to an exact visible agent. Idle starts, active queues, and unloaded reloads; optional execution changes apply only at the next assignment boundary.",
    promptSnippet: "Assign serialized retained-session follow-up work to an exact visible agent.",
    promptGuidelines: [
      "agent_followup: Use retained-session follow-up only when prior context materially helps the next assignment.",
      "agent_followup: Active work queues the assignment; execution changes never mutate an active turn.",
    ],
    parameters: FollowupParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_followup", params, signal),
    renderCall: (args, theme) => renderAgentCall("agent_followup", (args as FollowupParams | undefined)?.target, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_wait",
    label: "wait for agents",
    description:
      "Level-triggered wait for exact visible current assignments, or authorized bounded retrieval of a direct child's opaque completion artifact. Timeout or abort cancels only this wait and never interrupts agents.",
    promptSnippet: "Wait sparingly for exact visible assignments; page direct-child artifacts by opaque reference.",
    promptGuidelines: [
      "agent_wait: Use all for every snapshotted assignment or any for the first settlement; completed work cannot be missed between inspection and subscription.",
      "agent_wait: Timeout and caller abort cancel only the wait; never poll agent_list or loop short waits.",
      "agent_wait: Use operation=read_artifact only for an opaque reference delivered by your direct child; sibling and unrelated artifacts are denied centrally.",
      "agent_wait: Continue bounded pages with returned nextCursor until eof; never use or request a host path.",
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
      );
    },
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_interrupt",
    label: "interrupt agent",
    description:
      "Abort active work on one exact visible agent while preserving its resumable session. Idle or already interrupted work is idempotent.",
    promptSnippet: "Abort visible active work while preserving the agent for later follow-up.",
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
      "Return a compact centrally filtered snapshot of visible parent, sibling, and descendant agents without prompts, credentials, or control metadata.",
    promptSnippet: "Inspect compact visible collaboration state without using it as a completion poll.",
    promptGuidelines: [
      "agent_list: Use the centrally filtered snapshot for observation and exact identities, not synchronization or polling.",
    ],
    parameters: ListParamsSchema,
    execute: (_id, params, signal) => proxyTool(runtime, "agent_list", params, signal),
    renderCall: (_args, theme) => renderAgentCall("agent_list", undefined, theme),
    renderResult: (result, options, theme) => renderAgentResult(result, options.expanded, theme),
  });
  pi.registerTool({
    name: "agent_close",
    label: "close agent",
    description:
      "Permanently close one exact visible agent, abort active work, and release resident capacity. Closure is idempotent and cannot be resumed.",
    promptSnippet: "Permanently close one exact visible agent and release resident capacity.",
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

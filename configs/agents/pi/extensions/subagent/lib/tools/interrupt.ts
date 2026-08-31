import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderAgentCall, renderAgentResult } from "./render";
import { type TargetParams, TargetParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { toolBoundary } from "./shared";

export function registerAgentInterruptTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_interrupt",
    label: "interrupt agent",
    description:
      "Abort active work while preserving the resumable child session. Idle or already interrupted targets are idempotent; once issued, cleanup finishes even if the caller aborts.",
    promptSnippet: "Abort active work while preserving the agent for later follow-up.",
    promptGuidelines: [
      "agent_interrupt: Abort the active assignment while preserving the persistent session for later agent_followup.",
      "agent_interrupt: Idle and already interrupted targets are idempotent, and cleanup finishes once interruption is issued even if the caller aborts.",
      "agent_interrupt: Use agent_close instead when permanent shutdown and capacity release are required.",
    ],
    parameters: TargetParamsSchema,
    async execute(_id, params, signal) {
      return toolBoundary("agent_interrupt", () => runtime.supervisor.interrupt(params.target, signal));
    },
    renderCall(args, theme) {
      return renderAgentCall("agent_interrupt", (args as TargetParams | undefined)?.target, theme);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

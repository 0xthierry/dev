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
      "Stop an agent's active work while preserving its session for later follow-up. Safe to repeat; once issued, cleanup finishes even if the caller aborts.",
    promptSnippet: "Stop active work but keep the agent's session.",
    promptGuidelines: [
      "agent_interrupt: Use agent_followup to resume with another task, or agent_close for permanent shutdown.",
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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderAgentCall, renderAgentResult } from "./render";
import { type TargetParams, TargetParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { toolBoundary } from "./shared";

export function registerAgentCloseTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_close",
    label: "close agent",
    description:
      "Permanently close one exact agent with active-work abort, graceful shutdown, forced cleanup on deadline, and resident-capacity release. Close is idempotent and cannot be resumed.",
    promptSnippet: "Permanently close one exact agent and release its resident capacity.",
    promptGuidelines: [
      "agent_close: Closing is permanent, rejects future assignments, and cannot be resumed.",
      "agent_close: Active work is aborted, graceful shutdown escalates to forced cleanup on deadline, and resident capacity is released.",
      "agent_close: Repeated close is idempotent; use agent_interrupt instead when later follow-up may be needed.",
    ],
    parameters: TargetParamsSchema,
    async execute(_id, params, signal) {
      return toolBoundary("agent_close", () => runtime.supervisor.close(params.target, signal));
    },
    renderCall(args, theme) {
      return renderAgentCall("agent_close", (args as TargetParams | undefined)?.target, theme);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

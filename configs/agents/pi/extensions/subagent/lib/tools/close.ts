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
      "Permanently close an agent, stop its active work, and release capacity. Safe to repeat; a closed agent cannot be resumed.",
    promptSnippet: "Permanently close an agent and release capacity.",
    promptGuidelines: ["agent_close: Use agent_interrupt instead if you may need the agent's context later."],
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

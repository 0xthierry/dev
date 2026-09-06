import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderAgentCall, renderAgentResult } from "./render";
import { ListParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { toolBoundary } from "./shared";

export function registerAgentListTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_list",
    label: "list agents",
    description:
      "Inspect agents' IDs, canonical paths, statuses, current tasks, and effective provider/model/effort. Returns a compact snapshot without prompts or credentials.",
    promptSnippet: "Inspect agents' statuses, tasks, and effective settings.",
    promptGuidelines: ["agent_list: Inspect when needed; do not poll for completion. Use agent_wait when blocked."],
    parameters: ListParamsSchema,
    async execute(_id, _params, signal) {
      return toolBoundary("agent_list", () => runtime.supervisor.list(signal));
    },
    renderCall(_args, theme) {
      return renderAgentCall("agent_list", undefined, theme);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

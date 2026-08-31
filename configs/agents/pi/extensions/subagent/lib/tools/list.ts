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
      "Return a compact tree-ordered snapshot of agents with status, assignment, effective provider/model/effort, and resolution provenance; excludes prompts and control/auth metadata.",
    promptSnippet: "Inspect a compact tree snapshot of persistent agents and execution provenance.",
    promptGuidelines: [
      "agent_list: Use the compact tree snapshot for observation, not synchronization or completion polling.",
      "agent_list: The snapshot contains current assignments and effective execution provenance.",
      "agent_list: Output excludes raw prompts, authentication, headers, environment data, PIDs, socket paths, and tokens.",
      "agent_list: Use agent_wait for settlement instead of polling agent_list.",
    ],
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

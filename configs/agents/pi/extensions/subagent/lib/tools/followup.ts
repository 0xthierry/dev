import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderAgentCall, renderAgentResult } from "./render";
import { type FollowupParams, FollowupParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { assertAtomicExecution, toolBoundary } from "./shared";

export function registerAgentFollowupTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_followup",
    label: "follow up agent",
    description:
      "Assign the next task while retaining the child session: idle starts, active queues, and unloaded reloads. Optional execution is applied and verified only at the assignment boundary.",
    promptSnippet: "Assign retained-session follow-up work whose prior context materially helps.",
    promptGuidelines: [
      "agent_followup: Use retained-session follow-up only when the agent's prior context materially helps the next assignment.",
      "agent_followup: An idle agent starts, an active agent queues behind current work, and an unloaded resumable agent reloads its saved session.",
      "agent_followup: Optional execution changes are applied and verified at the assignment boundary, never mid-turn; provider and model remain atomic while effort is independent.",
      "agent_followup: Inspect the returned exact assignment identity and effective execution profile rather than assuming requested settings took effect.",
    ],
    parameters: FollowupParamsSchema,
    async execute(_id, params, signal, _update, ctx) {
      return toolBoundary("agent_followup", async () => {
        assertAtomicExecution(params.execution);
        const execution = params.execution
          ? await runtime.resolveExecution(params.execution, { operation: "followup", target: params.target, ctx })
          : undefined;
        return runtime.supervisor.followup({ target: params.target, message: params.message, execution, signal });
      });
    },
    renderCall(args, theme) {
      const params = args as FollowupParams | undefined;
      return renderAgentCall("agent_followup", params?.target, theme, params?.message);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

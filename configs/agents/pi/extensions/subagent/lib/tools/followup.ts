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
      "Give an existing agent its next task while retaining context. Idle starts, active queues, and unloaded resumes from its saved session. Execution changes apply at the next task boundary; omitting execution keeps current settings. For model selection, follow the guidance in agent_spawn.",
    promptSnippet: "Continue with an existing agent when its prior context helps the next task.",
    promptGuidelines: [
      "agent_followup: Reuse an agent when its prior context helps; inspect returned effective settings after requesting changes.",
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

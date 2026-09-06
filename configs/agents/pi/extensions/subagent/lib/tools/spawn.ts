import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_MODEL_GUIDANCE } from "./model-guidance";
import { renderAgentCall, renderAgentResult } from "./render";
import { type SpawnParams, SpawnParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { assertAtomicExecution, ToolInputError, toolBoundary } from "./shared";

export function registerAgentSpawnTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
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
      "agent_spawn: Inspect returned effective settings rather than assuming your requested overrides took effect.",
    ],
    parameters: SpawnParamsSchema,
    async execute(_id, params, signal, _update, ctx) {
      return toolBoundary("agent_spawn", async () => {
        assertAtomicExecution(params.execution);
        const execution = await runtime.resolveExecution(params.execution, {
          operation: "spawn",
          agentType: params.subagent_type,
          ctx,
        });
        const fork = params.context?.fork_turns === "all";
        const parentSessionFile = fork ? ctx.sessionManager.getSessionFile() : undefined;
        if (fork && !parentSessionFile) {
          throw new ToolInputError("parent_session_unavailable", "fork_turns all requires a saved parent session");
        }
        return runtime.supervisor.spawn({
          taskName: params.task_name,
          agentType: params.subagent_type,
          prompt: params.prompt,
          execution,
          context: fork ? { kind: "fork", parentSessionFile: parentSessionFile as string } : { kind: "isolated" },
          signal,
        });
      });
    },
    renderCall(args, theme) {
      const params = args as SpawnParams | undefined;
      return renderAgentCall("agent_spawn", params?.task_name, theme, params?.prompt);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

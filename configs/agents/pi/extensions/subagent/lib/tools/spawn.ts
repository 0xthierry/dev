import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderAgentCall, renderAgentResult } from "./render";
import { type SpawnParams, SpawnParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { assertAtomicExecution, ToolInputError, toolBoundary } from "./shared";

export function registerAgentSpawnTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_spawn",
    label: "spawn agent",
    description:
      "Start one persistent child below the caller. Returns after supervisor admission: running means the child accepted the prompt, while queued means capacity delayed child startup and prompt acceptance. Neither means completion. The result includes exact path, ID, assignment identity, and effective execution profile plus resolution sources.",
    promptSnippet: "Start one persistent child; running is prompt-accepted, while queued is admitted but not started.",
    promptGuidelines: [
      "agent_spawn: Delegate only concrete bounded work and give the child a self-contained contract with disjoint ownership.",
      "agent_spawn: Choose a path-safe task_name unique below the caller for the parent-session lifetime.",
      "agent_spawn: Omitted context or fork_turns none starts isolated; fork_turns all requires a saved parent session.",
      "agent_spawn: Provider and model must be supplied together; effort resolves independently, and locked repository conflicts fail.",
      "agent_spawn: Execution precedence is invocation, trusted repository, agent definition, then parent; inspect the returned exact effective profile and sources.",
      "agent_spawn: A running result means the child accepted the prompt; a queued result means only the supervisor admitted the assignment and child startup remains pending for capacity.",
      "agent_spawn: Neither running nor queued means completion; work proceeds in the background and artifact-backed completion goes to the direct parent.",
      "agent_spawn: Use agent_wait when settlement is required instead of treating admission or prompt acceptance as completion.",
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
      return renderAgentCall("agent_spawn", (args as SpawnParams | undefined)?.task_name, theme);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_WAIT_TIMEOUT_MS } from "../supervisor/limits";
import { renderAgentCall, renderAgentResult } from "./render";
import { type AgentWaitParams, AgentWaitParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { artifactPageSuccessResult, failureResult, ToolInputError, toolBoundary } from "./shared";

export function registerAgentWaitTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_wait",
    label: "wait for agents",
    description:
      "Wait for agents' current tasks: all returns when every task settles, any when one settles. Timeout or caller abort stops only the wait, not the agents. Also reads paginated completion artifacts.",
    promptSnippet: "Wait when blocked on agents, or read a completion artifact page.",
    promptGuidelines: [
      "agent_wait: Wait only when blocked and no independent work remains; do not loop short waits or poll agent_list.",
      "agent_wait: To read omitted output, use operation=read_artifact with a returned opaque artifact_ref, then page with nextCursor until eof; never use a host path.",
    ],
    parameters: AgentWaitParamsSchema,
    async execute(_id, params, signal) {
      if (params.operation === "read_artifact") {
        try {
          const result = await runtime.readArtifactPage(params.artifact_ref, {
            cursor: params.cursor,
            maxBytes: params.page_bytes,
            maxLines: params.page_lines,
          });
          if (!result.ok)
            throw new ToolInputError(result.reason.replaceAll("-", "_"), `Artifact read failed: ${result.reason}`);
          return artifactPageSuccessResult("agent_wait.read_artifact", result.page);
        } catch (error) {
          return failureResult("agent_wait.read_artifact", error);
        }
      }
      return toolBoundary<unknown>("agent_wait", () =>
        runtime.supervisor.wait({
          targets: params.targets,
          condition: params.condition ?? "all",
          timeoutMs: params.timeout_seconds === undefined ? DEFAULT_WAIT_TIMEOUT_MS : params.timeout_seconds * 1000,
          signal,
        }),
      );
    },
    renderCall(args, theme) {
      const params = args as AgentWaitParams | undefined;
      if (params?.operation === "read_artifact") return renderAgentCall("agent_wait", "artifact page", theme);
      const count = params?.targets.length;
      return renderAgentCall(
        "agent_wait",
        count === undefined ? undefined : `${count} target${count === 1 ? "" : "s"}`,
        theme,
        params?.targets.join(", "),
      );
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

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
      "Level-triggered wait on exact current assignment identities, or bounded paginated retrieval of an opaque completion artifact. Wait defaults to 30 seconds and permits up to one hour; artifact pages use UTF-8 byte cursors with 32 KiB and 200-line hard bounds.",
    promptSnippet:
      "Wait sparingly for exact current assignments; retrieve full outputs through bounded opaque artifact pages.",
    promptGuidelines: [
      "agent_wait: Use exact IDs or canonical paths; the supervisor snapshots each target's current assignment identity without prefix guessing.",
      "agent_wait: Level-triggered all waits for every snapshot and any returns after one settles, so completions between inspection and subscription are not missed.",
      "agent_wait: The default timeout is 30 seconds and the maximum is one hour; timeout or caller abort cancels only the wait, never child work.",
      "agent_wait: Results contain bounded completion previews and stable full-artifact references.",
      "agent_wait: Set operation=read_artifact with an opaque artifact_ref to retrieve omitted output; continue only with returned nextCursor until eof, never a host path.",
      "agent_wait: Artifact pages default to 16 KiB/120 lines and are hard-capped at 32 KiB/200 lines.",
      "agent_wait: Use sparingly when synchronization is required; do not poll agent_list or loop short waits.",
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
      );
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

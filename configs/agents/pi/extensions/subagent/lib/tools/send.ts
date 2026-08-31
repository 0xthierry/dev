import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAILBOX_LIMITS } from "../supervisor/mailbox";
import { renderAgentCall, renderAgentResult } from "./render";
import { type SendParams, SendParamsSchema } from "./schemas";
import type { AgentToolsRuntime } from "./shared";
import { ToolInputError, toolBoundary } from "./shared";

export function registerAgentSendTool(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  pi.registerTool({
    name: "agent_send",
    label: "send to agent",
    description:
      "Send up to 16 KiB to an exact agent ID or canonical path. Steers running work or queues durable mail for a resumable agent; never starts an assignment or changes execution.",
    promptSnippet: "Steer running work or queue bounded durable mail for an exact existing agent.",
    promptGuidelines: [
      "agent_send: Use an exact ID or canonical path returned by an agent tool; prefixes are never guessed.",
      "agent_send: A running target is steered, while an idle, interrupted, failed, or unloaded resumable target receives durable mailbox communication.",
      "agent_send: Communication is limited to 16 KiB and never starts an assignment or model turn.",
      "agent_send: Use agent_followup, not agent_send, for a new assignment or execution change.",
    ],
    parameters: SendParamsSchema,
    async execute(_id, params, signal) {
      return toolBoundary("agent_send", () => {
        if (Buffer.byteLength(params.message, "utf8") > DEFAULT_MAILBOX_LIMITS.maxMessageBytes) {
          throw new ToolInputError(
            "message_too_large",
            `agent_send message exceeds ${DEFAULT_MAILBOX_LIMITS.maxMessageBytes} UTF-8 bytes`,
          );
        }
        return runtime.supervisor.send({ target: params.target, message: params.message, signal });
      });
    },
    renderCall(args, theme) {
      const params = args as SendParams | undefined;
      return renderAgentCall("agent_send", params?.target, theme, params?.message);
    },
    renderResult(result, options, theme) {
      return renderAgentResult(result, options.expanded, theme);
    },
  });
}

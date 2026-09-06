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
      "Send a message to an existing agent. Steers running work or saves the message for a resumable agent; does not start a task.",
    promptSnippet: "Steer an agent or save a message without starting a task.",
    promptGuidelines: ["agent_send: Use agent_followup for a new task or execution change."],
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

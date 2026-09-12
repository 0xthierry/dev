export const SUBAGENT_MESSAGE_TYPE = "SUBAGENT_MESSAGE" as const;

export interface AgentReplyNotification {
  senderPath: string;
  taskName: string;
  message: string;
}

/** Formats one stable parent-facing message without altering the agent's payload. */
export function formatAgentReplyMessage(notification: AgentReplyNotification): string {
  return [
    `Message Type: ${SUBAGENT_MESSAGE_TYPE}`,
    `Task name: ${notification.taskName}`,
    `Sender: ${notification.senderPath}`,
    "Payload:",
    notification.message,
  ].join("\n");
}

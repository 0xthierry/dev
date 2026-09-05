import type { AmqNotifyRole } from "./binding";

export function buildNotice(drainOutput: string, role: AmqNotifyRole): string {
  const handling =
    role === "worker"
      ? "Handle the assigned task. Preserve the displayed message ID and answer that message with " +
        "`amq reply --id <message-id> --strict` so its thread and refs remain connected. Use " +
        "`amq send --strict` only for readiness or a genuinely new conversation."
      : "Handle it per its intent. If this is a worker result, relay it to the user. If a follow-up " +
        "is needed, answer the displayed message ID with `amq reply --id <message-id> --strict` so " +
        "its thread and refs remain connected; do not send a redundant acknowledgement.";

  return [
    "📬 AMQ — incoming message(s):",
    "",
    drainOutput.trim(),
    "",
    handling,
    "To keep waiting, just finish your turn by default. If the user explicitly asks for a manual " +
      "AMQ check, obey with one bounded AMQ command and do not substitute `.agent-mail` filesystem probes.",
  ].join("\n");
}

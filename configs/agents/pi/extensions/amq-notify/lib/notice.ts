export function buildNotice(drainOutput: string): string {
  return [
    "📬 AMQ — incoming message(s):",
    "",
    drainOutput.trim(),
    "",
    "Handle it per its intent. If this is the worker's result, relay it to the user; use " +
      "`amq send` only to follow up with the worker. To keep waiting, just finish your turn by " +
      "default. If the user explicitly asks for a manual AMQ check, obey with one bounded AMQ " +
      "command and do not substitute `.agent-mail` filesystem probes.",
  ].join("\n");
}

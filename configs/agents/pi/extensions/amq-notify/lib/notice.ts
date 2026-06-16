export function buildNotice(drainOutput: string): string {
  return [
    "📬 AMQ — incoming message(s):",
    "",
    drainOutput.trim(),
    "",
    "Handle it per its intent. If this is the worker's result, relay it to the user; use " +
      "`amq send` only to follow up with the worker. To keep waiting, just finish your turn — " +
      "do not run `amq monitor`/`amq drain`/`sleep`.",
  ].join("\n");
}

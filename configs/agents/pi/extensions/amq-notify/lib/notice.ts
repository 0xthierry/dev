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

const EMPTY_MONITOR_MARKERS = ["No new messages", "No messages to drain", "No messages available"];

/** True when an `amq monitor` run produced no actual message (timed out or empty). */
export function isEmptyMonitorOutput(out: string): boolean {
  const trimmed = out.trim();
  if (trimmed === "") return true;
  return EMPTY_MONITOR_MARKERS.some((m) => trimmed.startsWith(m));
}

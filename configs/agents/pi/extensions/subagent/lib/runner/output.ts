import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@mariozechner/pi-coding-agent";

export interface PreparedOutput {
  text: string;
  truncated: boolean;
}

export function prepareAgentOutput(text: string): PreparedOutput {
  const truncation = truncateTail(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return { text: truncation.content, truncated: false };

  const notice = [
    "",
    `[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`,
    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
  ].join("");

  return { text: `${truncation.content}\n\n${notice}`, truncated: true };
}

export function textFromContentParts(content: unknown): string {
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const value = part as Record<string, unknown>;
    if (value.type === "text" && typeof value.text === "string") parts.push(value.text);
  }
  return parts.join("\n");
}

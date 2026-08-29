import { formatSize, truncateTail } from "@earendil-works/pi-coding-agent";

export const AGENT_OUTPUT_PREVIEW_MAX_BYTES = 40 * 1024;
export const AGENT_OUTPUT_PREVIEW_MAX_LINES = 360;

export interface PreparedOutput {
  text: string;
  truncated: boolean;
}

export function prepareAgentOutput(text: string, artifactPath?: string, artifactError?: string): PreparedOutput {
  const truncation = truncateTail(text, {
    maxBytes: AGENT_OUTPUT_PREVIEW_MAX_BYTES,
    maxLines: AGENT_OUTPUT_PREVIEW_MAX_LINES,
  });
  const notices = outputNotices(truncation, artifactPath, artifactError);
  if (!truncation.truncated && notices.length === 0) return { text: truncation.content, truncated: false };

  return { text: [truncation.content, ...notices].filter(Boolean).join("\n\n"), truncated: truncation.truncated };
}

export function prepareAgentAggregateOutput(text: string): PreparedOutput {
  const initial = truncateTail(text, {
    maxBytes: AGENT_OUTPUT_PREVIEW_MAX_BYTES,
    maxLines: AGENT_OUTPUT_PREVIEW_MAX_LINES,
  });
  if (!initial.truncated) return { text: initial.content, truncated: false };

  const notice = `[Parallel subagent aggregate truncated: showing the retained tail within the ${formatSize(
    AGENT_OUTPUT_PREVIEW_MAX_BYTES,
  )} / ${AGENT_OUTPUT_PREVIEW_MAX_LINES}-line model-visible limit.]`;
  const suffix = `\n\n${notice}`;
  const truncation = truncateTail(text, {
    maxBytes: AGENT_OUTPUT_PREVIEW_MAX_BYTES - utf8ByteLength(suffix),
    maxLines: AGENT_OUTPUT_PREVIEW_MAX_LINES - newlineCount(suffix),
  });

  return { text: `${truncation.content}${suffix}`, truncated: true };
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function newlineCount(text: string): number {
  return text.split("\n").length - 1;
}

function outputNotices(
  truncation: ReturnType<typeof truncateTail>,
  artifactPath: string | undefined,
  artifactError: string | undefined,
): string[] {
  const notices: string[] = [];
  if (truncation.truncated) {
    notices.push(
      `[Output preview truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
        truncation.outputBytes,
      )} of ${formatSize(truncation.totalBytes)}).${artifactPath ? ` Read the full report at: ${artifactPath}` : ""}]`,
    );
  }
  if (artifactPath && !truncation.truncated) notices.push(`Detailed subagent output saved to: ${artifactPath}`);
  if (artifactError) notices.push(`Detailed subagent output artifact could not be saved: ${artifactError}`);
  return notices;
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

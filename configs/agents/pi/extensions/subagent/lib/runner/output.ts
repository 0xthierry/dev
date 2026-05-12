import { formatSize, truncateTail } from "@earendil-works/pi-coding-agent";

export const AGENT_OUTPUT_PREVIEW_MAX_BYTES = 4 * 1024;
export const AGENT_OUTPUT_PREVIEW_MAX_LINES = 80;

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

function outputNotices(
  truncation: ReturnType<typeof truncateTail>,
  artifactPath: string | undefined,
  artifactError: string | undefined,
): string[] {
  const notices: string[] = [];
  if (truncation.truncated) {
    notices.push(
      `[Output preview truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
        truncation.outputBytes,
      )} of ${formatSize(truncation.totalBytes)}).]`,
    );
  }
  if (artifactPath) notices.push(`Detailed subagent output saved to: ${artifactPath}`);
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

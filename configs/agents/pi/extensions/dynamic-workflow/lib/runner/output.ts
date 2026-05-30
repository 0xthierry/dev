import { formatSize, truncateTail } from "@earendil-works/pi-coding-agent";

export const WORKFLOW_OUTPUT_PREVIEW_MAX_BYTES = 4 * 1024;
export const WORKFLOW_OUTPUT_PREVIEW_MAX_LINES = 80;
export const WORKFLOW_ARTIFACT_OUTPUT_PREVIEW_MAX_BYTES = 1200;
export const WORKFLOW_ARTIFACT_OUTPUT_PREVIEW_MAX_LINES = 12;

export interface PreparedWorkflowOutput {
  text: string;
  truncated: boolean;
}

export function prepareWorkflowOutput(text: string, artifactPath?: string): PreparedWorkflowOutput {
  const truncation = truncateTail(text, {
    maxBytes: artifactPath ? WORKFLOW_ARTIFACT_OUTPUT_PREVIEW_MAX_BYTES : WORKFLOW_OUTPUT_PREVIEW_MAX_BYTES,
    maxLines: artifactPath ? WORKFLOW_ARTIFACT_OUTPUT_PREVIEW_MAX_LINES : WORKFLOW_OUTPUT_PREVIEW_MAX_LINES,
  });
  const notices = outputNotices(truncation, artifactPath);
  if (!truncation.truncated && notices.length === 0) return { text: truncation.content, truncated: false };

  return { text: [truncation.content, ...notices].filter(Boolean).join("\n\n"), truncated: truncation.truncated };
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

function outputNotices(truncation: ReturnType<typeof truncateTail>, artifactPath: string | undefined): string[] {
  const notices: string[] = [];
  if (truncation.truncated) {
    notices.push(
      `[Output preview truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(
        truncation.outputBytes,
      )} of ${formatSize(truncation.totalBytes)}).]`,
    );
  }
  if (artifactPath) notices.push(`Detailed workflow agent output saved to: ${artifactPath}`);
  return notices;
}

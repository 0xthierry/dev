import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { formatWebAccessError, type WebAccessError } from "../shared/errors";

export function formatToolError(error: WebAccessError): string {
  return formatWebAccessError(error);
}

export function errorResult(
  error: WebAccessError,
  details: Record<string, unknown> = {},
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text: formatToolError(error) }],
    details: { ...details, error },
  };
}

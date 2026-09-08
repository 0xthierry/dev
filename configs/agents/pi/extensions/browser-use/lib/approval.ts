export type BrowserUseApprovalResponse = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
};

export type BrowserUseApprovalHandler = (params: unknown, signal: AbortSignal) => Promise<BrowserUseApprovalResponse>;

export type BrowserUseConfirmation = (message: string, signal: AbortSignal) => Promise<boolean | undefined>;

export function createBrowserUseApprovalHandler(confirm: BrowserUseConfirmation): BrowserUseApprovalHandler {
  return async (params, signal) => {
    const message = browserUseApprovalMessage(params);
    if (!message || signal.aborted) return { action: "cancel" };
    const accepted = await confirm(message, signal);
    if (signal.aborted || accepted === undefined) return { action: "cancel" };
    return accepted ? { action: "accept", content: {} } : { action: "decline" };
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function browserUseApprovalMessage(params: unknown): string | undefined {
  const request = record(params);
  if (!request || typeof request.message !== "string" || !request.message.trim()) return;
  if (request.mode !== undefined && request.mode !== "form") return;
  const metadata = { ...record(request.meta), ...record(request._meta) };
  // A user confirmation is NOT an automated safety review. Never forge reviewer metadata.
  if (record(request.meta)?.codex_strict_auto_review || record(request._meta)?.codex_strict_auto_review) return;
  const schema = record(request.requestedSchema);
  if (!schema || schema.type !== "object") return;
  const properties = record(schema.properties);
  if (!properties || Object.keys(properties).length !== 0) return;
  if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length > 0)) return;
  const context = [
    typeof metadata.tool_name === "string" ? `Action: ${metadata.tool_name}` : "",
    typeof metadata.origin === "string" ? `Origin: ${metadata.origin}` : "",
    metadata.tool_params !== undefined ? `Parameters: ${JSON.stringify(metadata.tool_params)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const message = [request.message, context, "Pi will not request persistent permission."].filter(Boolean).join("\n\n");
  // Do not truncate a security decision and hide part of the requested action.
  if (message.length > 8_000) return;
  for (const character of message) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) return;
  }
  return message;
}

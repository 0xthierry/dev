export type BrowserUseContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export type BrowserUseExecutionResult = {
  content: BrowserUseContentBlock[];
  text: string;
  isError: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidResult(): BrowserUseExecutionResult {
  // Do not echo malformed payloads: they can contain browser data or credentials.
  const text = "Browser kernel returned a malformed or unsupported result.";
  return { content: [{ type: "text", text }], text, isError: true };
}

export function parseBrowserUseToolResult(value: unknown): BrowserUseExecutionResult {
  if (
    !isRecord(value) ||
    !Array.isArray(value.content) ||
    (value.isError !== undefined && typeof value.isError !== "boolean")
  ) {
    return invalidResult();
  }

  const content: BrowserUseContentBlock[] = [];
  for (const block of value.content) {
    if (!isRecord(block) || typeof block.type !== "string" || !block.type) {
      return invalidResult();
    }
    switch (block.type) {
      case "text":
        if (typeof block.text !== "string") return invalidResult();
        content.push({ type: "text", text: block.text });
        break;
      case "image":
        if (
          typeof block.data !== "string" ||
          !block.data ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block.data) ||
          typeof block.mimeType !== "string" ||
          !/^image\/[a-zA-Z0-9][a-zA-Z0-9.+-]*$/.test(block.mimeType)
        ) {
          return invalidResult();
        }
        content.push({ type: "image", data: block.data, mimeType: block.mimeType });
        break;
      // MCP can include other block types that Pi cannot represent.
      default:
        break;
    }
  }
  if (value.content.length > 0 && content.length === 0) return invalidResult();

  let text = content.flatMap((block) => (block.type === "text" && block.text ? [block.text] : [])).join("\n");
  if (value.isError === true && !text) {
    text = "Browser kernel returned an error with no text.";
    content.push({ type: "text", text });
  }
  return { content, text, isError: value.isError === true };
}

export function createTurnMetadata(sessionId: string, turnId: string): Record<string, unknown> {
  return {
    progressToken: turnId,
    threadId: sessionId,
    "x-codex-turn-metadata": {
      session_id: sessionId,
      turn_id: turnId,
      thread_id: sessionId,
      sandbox: "danger-full-access",
      thread_source: "user",
    },
  };
}

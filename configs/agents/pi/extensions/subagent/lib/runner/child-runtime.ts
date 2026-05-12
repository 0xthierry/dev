import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PARENT_AGENT_TOOL_NAMES = new Set(["agent", "Agent"]);

export function stripParentAgentMessages<T>(messages: T[]): T[] {
  let changed = false;
  const filtered: T[] = [];

  for (const message of messages) {
    if (isParentAgentToolResult(message)) {
      changed = true;
      continue;
    }

    const stripped = stripAssistantAgentToolCalls(message);
    if (stripped === undefined) {
      changed = true;
      continue;
    }
    if (stripped !== message) changed = true;
    filtered.push(stripped as T);
  }

  return changed ? filtered : messages;
}

export default function registerSubagentChildRuntime(pi: ExtensionAPI): void {
  pi.on("context", (event) => {
    const messages = stripParentAgentMessages(event.messages);
    if (messages === event.messages) return undefined;
    return { messages };
  });
}

function isParentAgentToolResult(message: unknown): boolean {
  const value = objectValue(message);
  return value?.role === "toolResult" && isParentAgentToolName(value.toolName);
}

function stripAssistantAgentToolCalls(message: unknown): unknown | undefined {
  const value = objectValue(message);
  if (value?.role !== "assistant" || !Array.isArray(value.content)) return message;

  const content = value.content.filter((part) => !isParentAgentToolCall(part));
  if (content.length === value.content.length) return message;
  if (content.length === 0) return undefined;
  return { ...value, content };
}

function isParentAgentToolCall(part: unknown): boolean {
  const value = objectValue(part);
  return value?.type === "toolCall" && isParentAgentToolName(value.name);
}

function isParentAgentToolName(value: unknown): boolean {
  return typeof value === "string" && PARENT_AGENT_TOOL_NAMES.has(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

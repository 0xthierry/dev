import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { JsonObject } from "./types";

export function messagesToCodexResponseItems(messages: AgentMessage[]): JsonObject[] {
  return llmMessagesToCodexResponseItems(convertToLlm(messages));
}

export function llmMessagesToCodexResponseItems(messages: Message[]): JsonObject[] {
  const items: JsonObject[] = [];
  const completedToolCallIds = collectToolResultCallIds(messages);
  const emittedToolCallIds = new Set<string>();
  let messageIndex = 0;

  for (const message of messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: toInputContent(message.content) });
    } else if (message.role === "assistant") {
      const assistantItems = assistantToResponseItems(message, messageIndex, completedToolCallIds);
      for (const item of assistantItems) trackFunctionCall(item, emittedToolCallIds);
      items.push(...assistantItems);
    } else if (message.role === "toolResult") {
      const callId = toolResultCallId(message);
      if (!emittedToolCallIds.has(callId)) {
        const recoveredCall = recoveredFunctionCallForToolResult(message);
        trackFunctionCall(recoveredCall, emittedToolCallIds);
        items.push(recoveredCall);
      }
      items.push(toolResultToResponseItem(message));
    }
    messageIndex += 1;
  }

  return items;
}

function assistantToResponseItems(
  message: AssistantMessage,
  messageIndex: number,
  completedToolCallIds: ReadonlySet<string>,
): JsonObject[] {
  const items: JsonObject[] = [];
  let textBlockIndex = 0;

  for (const block of message.content) {
    if (block.type === "thinking") {
      const signedItem = parseSignedResponseItem(block.thinkingSignature);
      if (signedItem) items.push(signedItem);
      continue;
    }

    if (block.type === "text") {
      const fallbackId =
        textBlockIndex === 0 ? `msg_pi_codex_${messageIndex}` : `msg_pi_codex_${messageIndex}_${textBlockIndex}`;
      items.push({
        type: "message",
        role: "assistant",
        status: "completed",
        id: fallbackId,
        content: [{ type: "output_text", text: block.text, annotations: [] }],
      });
      textBlockIndex += 1;
      continue;
    }

    if (block.type === "toolCall") {
      const [callId, itemId] = block.id.split("|");
      items.push({
        type: "function_call",
        id: itemId,
        call_id: callId,
        name: block.name,
        arguments: JSON.stringify(block.arguments),
      });
      if (!completedToolCallIds.has(callId)) {
        items.push(missingToolResultToResponseItem(callId, message));
      }
    }
  }

  return items;
}

function toolResultToResponseItem(message: ToolResultMessage): JsonObject {
  const callId = toolResultCallId(message);
  const text = message.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("\n");
  const images = message.content.filter((content): content is ImageContent => content.type === "image");

  return {
    type: "function_call_output",
    call_id: callId,
    output: images.length === 0 ? (text.length > 0 ? text : "") : text.length > 0 ? text : "(see attached image)",
  };
}

function collectToolResultCallIds(messages: Message[]): Set<string> {
  const callIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "toolResult") callIds.add(toolResultCallId(message));
  }
  return callIds;
}

function toolResultCallId(message: ToolResultMessage): string {
  const [callId] = message.toolCallId.split("|");
  return callId;
}

function toolResultItemId(message: ToolResultMessage): string {
  const [, itemId] = message.toolCallId.split("|");
  return itemId && itemId.length > 0 ? itemId : `fc_pi_recovered_${toolResultCallId(message)}`;
}

function recoveredFunctionCallForToolResult(message: ToolResultMessage): JsonObject {
  return {
    type: "function_call",
    id: toolResultItemId(message),
    call_id: toolResultCallId(message),
    name: message.toolName,
    arguments: "{}",
  };
}

function trackFunctionCall(item: JsonObject, callIds: Set<string>): void {
  if (item.type === "function_call" && typeof item.call_id === "string") callIds.add(item.call_id);
}

function missingToolResultToResponseItem(callId: string, message: AssistantMessage): JsonObject {
  return {
    type: "function_call_output",
    call_id: callId,
    output: missingToolResultOutput(message),
  };
}

function missingToolResultOutput(message: AssistantMessage): string {
  const errorMessage = (message as { errorMessage?: unknown }).errorMessage;
  if (typeof errorMessage === "string" && errorMessage.trim().length > 0) {
    return `Tool call did not complete because the assistant turn failed before Pi recorded tool output: ${errorMessage.trim()}`;
  }

  return "Tool call did not complete because the assistant turn ended before Pi recorded tool output.";
}

function toInputContent(content: string | (TextContent | ImageContent)[]): string | JsonObject[] {
  if (typeof content === "string") return content;

  const items: JsonObject[] = [];
  for (const block of content) {
    if (block.type === "text") {
      items.push({ type: "input_text", text: block.text });
    } else if (block.type === "image") {
      items.push({
        type: "input_image",
        detail: "auto",
        image_url: `data:${block.mimeType};base64,${block.data}`,
      });
    }
  }

  return items;
}

function parseSignedResponseItem(signature: string | undefined): JsonObject | undefined {
  if (!signature) return undefined;

  try {
    const parsed = JSON.parse(signature) as unknown;
    return isJsonObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

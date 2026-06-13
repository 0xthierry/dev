import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { JsonObject } from "./types";

export function messagesToCodexResponseItems(messages: AgentMessage[]): JsonObject[] {
  return llmMessagesToCodexResponseItems(convertToLlm(messages));
}

export function llmMessagesToCodexResponseItems(messages: Message[]): JsonObject[] {
  const items: JsonObject[] = [];
  let messageIndex = 0;

  for (const message of messages) {
    if (message.role === "user") {
      items.push({ role: "user", content: toInputContent(message.content) });
    } else if (message.role === "assistant") {
      items.push(...assistantToResponseItems(message, messageIndex));
    } else if (message.role === "toolResult") {
      items.push(toolResultToResponseItem(message));
    }
    messageIndex += 1;
  }

  return items;
}

function assistantToResponseItems(message: AssistantMessage, messageIndex: number): JsonObject[] {
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
    }
  }

  return items;
}

function toolResultToResponseItem(message: ToolResultMessage): JsonObject {
  const [callId] = message.toolCallId.split("|");
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

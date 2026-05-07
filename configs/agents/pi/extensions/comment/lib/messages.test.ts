import { describe, expect, test } from "bun:test";
import type { AssistantMessage, StopReason, UserMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { extractLastAssistantText } from "./messages";

describe("extractLastAssistantText", () => {
  test("returns trimmed text from the latest completed assistant message", () => {
    // Arrange
    const branch = [
      messageEntry(userMessage("Please explain.")),
      messageEntry(assistantMessage(" earlier answer ")),
      messageEntry(userMessage("Again.")),
      messageEntry(assistantMessage(["Final answer", "second line"])),
    ];

    // Act
    const result = extractLastAssistantText(branch);

    // Assert
    expect(result).toEqual({ ok: true, text: "Final answer\nsecond line" });
  });

  test("ignores non-message entries and non-assistant messages", () => {
    // Arrange
    const branch = [
      messageEntry(assistantMessage("answer")),
      {
        type: "model_change",
        id: "model",
        parentId: null,
        timestamp: new Date(0).toISOString(),
        provider: "p",
        modelId: "m",
      },
      messageEntry(userMessage("not this")),
    ] satisfies SessionEntry[];

    // Act
    const result = extractLastAssistantText(branch);

    // Assert
    expect(result).toEqual({ ok: true, text: "answer" });
  });

  test("reports an incomplete latest assistant message", () => {
    // Arrange
    const branch = [messageEntry(assistantMessage("needs tool", "toolUse"))];

    // Act
    const result = extractLastAssistantText(branch);

    // Assert
    expect(result).toEqual({ ok: false, reason: "incompleteAssistantMessage", stopReason: "toolUse" });
  });

  test("reports a completed assistant message without text", () => {
    // Arrange
    const branch = [messageEntry(assistantMessage([], "stop"))];

    // Act
    const result = extractLastAssistantText(branch);

    // Assert
    expect(result).toEqual({ ok: false, reason: "assistantMessageHasNoText" });
  });

  test("reports when the branch has no assistant messages", () => {
    // Arrange
    const branch = [messageEntry(userMessage("hello"))];

    // Act
    const result = extractLastAssistantText(branch);

    // Assert
    expect(result).toEqual({ ok: false, reason: "noAssistantMessage" });
  });
});

function messageEntry(message: UserMessage | AssistantMessage): SessionEntry {
  return {
    type: "message",
    id: "entry-id",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message,
  };
}

function userMessage(text: string): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp: 0,
  };
}

function assistantMessage(text: string | string[], stopReason: StopReason = "stop"): AssistantMessage {
  const content = Array.isArray(text)
    ? text.map((part) => ({ type: "text" as const, text: part }))
    : [{ type: "text" as const, text }];

  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

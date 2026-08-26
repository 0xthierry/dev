import { describe, expect, test } from "bun:test";
import { extractOracleConversationText } from "./conversation";

const TURN_ID = "current-turn";

function assistantMessage(
  id: string,
  contentType: string,
  options: {
    text?: string;
    turnExchangeId?: string;
    channel?: string;
    recipient?: string;
    status?: string;
    endTurn?: boolean;
    reasoningStatus?: string;
    finishType?: string;
    model?: string;
    visuallyHidden?: boolean;
  } = {},
) {
  return {
    id,
    author: { role: "assistant" },
    recipient: options.recipient ?? "all",
    ...(options.channel ? { channel: options.channel } : {}),
    status: options.status ?? "finished_successfully",
    end_turn: options.endTurn ?? true,
    content: { content_type: contentType, parts: options.text ? [options.text] : [] },
    metadata: {
      turn_exchange_id: options.turnExchangeId ?? TURN_ID,
      model_slug: options.model ?? "gpt-5-6-pro",
      ...(options.reasoningStatus ? { reasoning_status: options.reasoningStatus } : {}),
      ...(options.finishType ? { finish_details: { type: options.finishType } } : {}),
      ...(options.visuallyHidden ? { is_visually_hidden: true } : {}),
    },
  };
}

function completedProConversation() {
  return {
    current_node: "final",
    mapping: {
      thoughts: {
        parent: null,
        message: assistantMessage("thoughts", "thoughts", {
          endTurn: false,
          reasoningStatus: "is_reasoning",
        }),
      },
      recap: {
        parent: "thoughts",
        message: assistantMessage("recap", "reasoning_recap", { reasoningStatus: "reasoning_ended" }),
      },
      final: {
        parent: "recap",
        message: assistantMessage("final-message", "text", { text: "complete answer", finishType: "stop" }),
      },
    },
  };
}

describe("extractOracleConversationText", () => {
  test("extracts the final text after the current Pro turn reports reasoning ended", () => {
    // Arrange
    const conversation = completedProConversation();

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toEqual({
      text: "complete answer",
      messageId: "final-message",
      currentNode: "final-message",
      model: "gpt-5-6-pro",
      status: "finished_successfully",
      finished: true,
    });
  });

  test("does not treat a finished commentary message as the final Pro answer", () => {
    // Arrange
    const conversation = {
      current_node: "commentary",
      mapping: {
        commentary: {
          parent: null,
          message: assistantMessage("commentary", "text", {
            text: "I will evaluate the options.",
            channel: "commentary",
          }),
        },
      },
    };

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toBeNull();
  });

  test("ignores a completed previous turn while the requested Pro turn is still reasoning", () => {
    // Arrange
    const conversation = completedProConversation();
    conversation.current_node = "current-thoughts";
    conversation.mapping.thoughts.message.metadata.turn_exchange_id = "previous-turn";
    conversation.mapping.recap.message.metadata.turn_exchange_id = "previous-turn";
    conversation.mapping.final.message.metadata.turn_exchange_id = "previous-turn";
    Object.assign(conversation.mapping, {
      "current-thoughts": {
        parent: "final",
        message: assistantMessage("current-thoughts", "thoughts", {
          endTurn: false,
          reasoningStatus: "is_reasoning",
        }),
      },
    });

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toBeNull();
  });

  test("rejects a terminal-looking answer when same-turn reasoning resumes after it", () => {
    // Arrange
    const conversation = completedProConversation();
    conversation.current_node = "resumed-thoughts";
    Object.assign(conversation.mapping, {
      "resumed-thoughts": {
        parent: "final",
        message: assistantMessage("resumed-thoughts", "thoughts", {
          endTurn: false,
          reasoningStatus: "is_reasoning",
        }),
      },
    });

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toBeNull();
  });

  test("rejects a visually hidden final-looking Pro answer", () => {
    // Arrange
    const conversation = completedProConversation();
    conversation.mapping.final.message.metadata.is_visually_hidden = true;

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toBeNull();
  });

  test("extracts a completed instant answer only from the submitted request branch", () => {
    // Arrange
    const conversation = {
      current_node: "instant-final",
      mapping: {
        old: {
          parent: null,
          message: assistantMessage("old", "text", {
            text: "old answer",
            turnExchangeId: "previous-turn",
          }),
        },
        request: {
          parent: "old",
          message: {
            id: "request-message",
            author: { role: "user" },
            status: "finished_successfully",
            content: { content_type: "text", parts: ["question"] },
          },
        },
        "instant-final": {
          parent: "request",
          message: assistantMessage("instant-answer", "text", {
            text: "instant answer",
            turnExchangeId: "instant-turn",
          }),
        },
      },
    };

    // Act
    const result = extractOracleConversationText(conversation, {
      kind: "instant",
      requestMessageId: "request-message",
    });

    // Assert
    expect(result?.text).toBe("instant answer");
    expect(result?.messageId).toBe("instant-answer");
  });

  test("fails closed when the conversation current node is not present in the mapping", () => {
    // Arrange
    const conversation = completedProConversation();
    conversation.current_node = "unresolved-node";

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toBeNull();
  });

  test("returns null when there is no conversation mapping", () => {
    // Arrange
    const conversation = { current_node: "missing" };

    // Act
    const result = extractOracleConversationText(conversation, { kind: "pro", turnExchangeId: TURN_ID });

    // Assert
    expect(result).toBeNull();
  });
});

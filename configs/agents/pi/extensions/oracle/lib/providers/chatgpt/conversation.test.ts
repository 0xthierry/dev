import { describe, expect, test } from "bun:test";
import { extractOracleConversationText } from "./conversation";

describe("extractOracleConversationText", () => {
  test("extracts the latest finished assistant text from conversation mapping", () => {
    // Arrange
    const conversation = {
      current_node: "latest-message",
      mapping: {
        user: {
          message: {
            author: { role: "user" },
            content: { parts: ["question"] },
          },
        },
        older: {
          message: {
            id: "older-message",
            author: { role: "assistant" },
            create_time: 1,
            status: "finished_successfully",
            content: { parts: ["older answer"] },
          },
        },
        latest: {
          message: {
            id: "latest-message",
            author: { role: "assistant" },
            create_time: 2,
            status: "finished_successfully",
            metadata: { model_slug: "gpt-5-6-sol-pro" },
            content: { parts: ["latest answer"] },
          },
        },
      },
    };

    // Act
    const result = extractOracleConversationText(conversation);

    // Assert
    expect(result).toEqual({
      text: "latest answer",
      messageId: "latest-message",
      currentNode: "latest-message",
      model: "gpt-5-6-sol-pro",
      status: "finished_successfully",
      finished: true,
    });
  });

  test("extracts structured text parts and reports unfinished status", () => {
    // Arrange
    const conversation = {
      current_node: "message-id",
      mapping: {
        node: {
          message: {
            id: "message-id",
            author: { role: "assistant" },
            status: "in_progress",
            metadata: { model_slug: "gpt-5-6-sol-pro" },
            content: { parts: [{ content_type: "text", text: "partial answer" }] },
          },
        },
      },
    };

    // Act
    const result = extractOracleConversationText(conversation);

    // Assert
    expect(result).toEqual({
      text: "partial answer",
      messageId: "message-id",
      currentNode: "message-id",
      model: "gpt-5-6-sol-pro",
      status: "in_progress",
      finished: false,
    });
  });

  test("returns null when there is no assistant text", () => {
    // Arrange
    const conversation = { mapping: { node: { message: { author: { role: "assistant" }, content: { parts: [] } } } } };

    // Act
    const result = extractOracleConversationText(conversation);

    // Assert
    expect(result).toBeNull();
  });
});

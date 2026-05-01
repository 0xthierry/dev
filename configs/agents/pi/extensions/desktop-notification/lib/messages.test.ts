import { describe, expect, test } from "bun:test";
import { extractLastAssistantText, isTextPart } from "./messages";

describe("isTextPart", () => {
  test("accepts text content parts", () => {
    // Arrange
    const part = { type: "text", text: "Hello" };

    // Act
    const result = isTextPart(part);

    // Assert
    expect(result).toBe(true);
  });

  test("rejects non-text content parts", () => {
    // Arrange
    const part = { type: "toolCall", text: "not assistant text" };

    // Act
    const result = isTextPart(part);

    // Assert
    expect(result).toBe(false);
  });
});

describe("extractLastAssistantText", () => {
  test("returns trimmed string content from the latest assistant message", () => {
    // Arrange
    const messages = [
      { role: "assistant", content: " earlier " },
      { role: "user", content: "ignore me" },
      { role: "assistant", content: " latest " },
    ];

    // Act
    const result = extractLastAssistantText(messages);

    // Assert
    expect(result).toBe("latest");
  });

  test("joins text parts from assistant content arrays", () => {
    // Arrange
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "First" },
          { type: "toolCall", name: "ignored" },
          { type: "text", text: "Second" },
        ],
      },
    ];

    // Act
    const result = extractLastAssistantText(messages);

    // Assert
    expect(result).toBe("First\nSecond");
  });

  test("returns null when no assistant text exists", () => {
    // Arrange
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "   " },
    ];

    // Act
    const result = extractLastAssistantText(messages);

    // Assert
    expect(result).toBeNull();
  });
});

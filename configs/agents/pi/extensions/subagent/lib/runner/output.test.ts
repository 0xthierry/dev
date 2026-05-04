import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_BYTES } from "@mariozechner/pi-coding-agent";
import { prepareAgentOutput, textFromContentParts } from "./output";

describe("prepareAgentOutput", () => {
  test("keeps short output unchanged", () => {
    // Arrange
    const output = "short result";

    // Act
    const result = prepareAgentOutput(output);

    // Assert
    expect(result).toEqual({ text: "short result", truncated: false });
  });

  test("truncates large output", () => {
    // Arrange
    const output = "x".repeat(DEFAULT_MAX_BYTES + 100);

    // Act
    const result = prepareAgentOutput(output);

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("Output truncated");
    expect(result.text.length).toBeLessThan(output.length);
  });
});

describe("textFromContentParts", () => {
  test("joins text content parts", () => {
    // Arrange
    const content = [
      { type: "text", text: "first" },
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "second" },
    ];

    // Act
    const result = textFromContentParts(content);

    // Assert
    expect(result).toBe("first\nsecond");
  });
});

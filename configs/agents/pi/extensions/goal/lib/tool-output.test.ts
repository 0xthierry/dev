import { describe, expect, test } from "bun:test";
import { truncateToolText } from "./tool-output";

describe("truncateToolText", () => {
  test("keeps small tool output unchanged", () => {
    // Arrange
    const text = "small output";

    // Act
    const result = truncateToolText(text, "Demo");

    // Assert
    expect(result).toBe(text);
  });

  test("truncates large tool output and explains where full structured data lives", () => {
    // Arrange
    const text = `${"x".repeat(60_000)}\nlast line`;

    // Act
    const result = truncateToolText(text, "Demo");

    // Assert
    expect(result.length).toBeLessThan(text.length);
    expect(result).toContain("Demo truncated");
    expect(result).toContain("Full structured data is available in tool result details");
  });
});

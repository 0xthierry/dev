import { describe, expect, test } from "bun:test";
import { formatQuotedMarkdown } from "./quote";

describe("formatQuotedMarkdown", () => {
  test("quotes every line with a Markdown blockquote marker", () => {
    // Arrange
    const text = "First line\nSecond line";

    // Act
    const result = formatQuotedMarkdown(text);

    // Assert
    expect(result).toBe("> First line\n> Second line");
  });

  test("preserves blank lines as quoted blank lines", () => {
    // Arrange
    const text = "Before\n\nAfter";

    // Act
    const result = formatQuotedMarkdown(text);

    // Assert
    expect(result).toBe("> Before\n> \n> After");
  });
});

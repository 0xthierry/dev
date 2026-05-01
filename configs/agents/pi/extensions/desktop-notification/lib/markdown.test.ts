import { describe, expect, test } from "bun:test";
import { renderPlainMarkdown } from "./markdown";

describe("renderPlainMarkdown", () => {
  test("renders markdown without styling markers", () => {
    // Arrange
    const markdown = "**Done** with `tests`.";

    // Act
    const result = renderPlainMarkdown(markdown);

    // Assert
    expect(result).toContain("Done");
    expect(result).toContain("tests");
    expect(result).not.toContain("**");
    expect(result).not.toContain("`");
  });
});

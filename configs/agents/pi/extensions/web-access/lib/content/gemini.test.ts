import { describe, expect, test } from "bun:test";
import { buildGeminiExtractionPrompt } from "./gemini";

describe("buildGeminiExtractionPrompt", () => {
  test("asks for complete readable markdown without summarizing", () => {
    // Arrange
    const url = "https://example.com/docs";

    // Act
    const prompt = buildGeminiExtractionPrompt(url);

    // Assert
    expect(prompt).toContain("complete readable content");
    expect(prompt).toContain("Do not summarize");
    expect(prompt).toContain("URL: https://example.com/docs");
  });
});

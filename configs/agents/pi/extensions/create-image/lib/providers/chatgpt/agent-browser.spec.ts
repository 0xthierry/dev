import { describe, expect, test } from "bun:test";
import { createChatGptAgentBrowserProvider } from "./agent-browser";

describe("create-image ChatGPT browser/CDP fallback live contract", () => {
  test("generates downloadable image bytes through agent-browser", async () => {
    // Arrange
    const provider = createChatGptAgentBrowserProvider();

    // Act
    const result = await provider.generate({
      prompt:
        "Generate one small square image of a single yellow circle centered on a plain white background. Use ChatGPT image generation.",
    });

    // Assert
    expect(result.providerId).toBe("chatgpt-web");
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]?.mimeType).toMatch(/^image\//);
    expect(result.images[0]?.bytes.length ?? 0).toBeGreaterThan(1000);
  }, 300_000);
});

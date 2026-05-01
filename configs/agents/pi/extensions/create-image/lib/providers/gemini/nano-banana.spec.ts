import { describe, expect, test } from "bun:test";
import { createGeminiNanoBananaProvider } from "./nano-banana";

const ENABLE_LIVE_SPEC = process.env.PI_CREATE_IMAGE_LIVE_SPEC === "1";

describe("create-image Nano Banana live contract", () => {
  test("generates downloadable image bytes through Gemini Web cookies", async () => {
    // Arrange
    if (!ENABLE_LIVE_SPEC) {
      console.warn("Skipping Nano Banana live contract. Set PI_CREATE_IMAGE_LIVE_SPEC=1 to enable.");
      return;
    }
    const provider = createGeminiNanoBananaProvider();

    // Act
    const result = await provider.generate({
      prompt:
        "Generate one small square image of a single red circle centered on a plain white background. Use Nano Banana image generation. Do not send web images.",
    });

    // Assert
    expect(result.providerId).toBe("nano-banana");
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]?.mimeType).toMatch(/^image\//);
    expect(result.images[0]?.bytes.length ?? 0).toBeGreaterThan(1000);
  }, 240_000);
});

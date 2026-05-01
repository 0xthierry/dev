import { describe, expect, test } from "bun:test";
import { createChatGptDirectProvider } from "./direct";

const ENABLE_LIVE_SPEC = process.env.PI_CREATE_IMAGE_CHATGPT_LIVE_SPEC === "1";

describe("create-image ChatGPT direct Web live contract", () => {
  test("generates downloadable image bytes through direct ChatGPT Web HTTP", async () => {
    // Arrange
    if (!ENABLE_LIVE_SPEC) {
      console.warn("Skipping ChatGPT direct Web live contract. Set PI_CREATE_IMAGE_CHATGPT_LIVE_SPEC=1 to enable.");
      return;
    }
    const provider = createChatGptDirectProvider();

    // Act
    const result = await provider.generate({
      prompt:
        "Generate one small square image of a single yellow hexagon centered on a plain white background. Use ChatGPT image generation.",
    });

    // Assert
    expect(result.providerId).toBe("chatgpt-web");
    expect(result.images.length).toBeGreaterThan(0);
    expect(result.images[0]?.mimeType).toMatch(/^image\//);
    const bytes = result.images[0]?.bytes ?? new Uint8Array();
    expect(bytes.length).toBeGreaterThan(1000);
    expect(isRecognizedImage(bytes)).toBe(true);
  }, 300_000);
});

function isRecognizedImage(bytes: Uint8Array): boolean {
  return (
    (bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a) ||
    (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    (bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50)
  );
}

import { describe, expect, test } from "bun:test";
import { listProviderIds, resolveImageProvider } from "./registry";
import type { ImageGenerationProvider } from "./types";

const nanoBanana: ImageGenerationProvider = {
  id: "nano-banana",
  aliases: ["gemini", "gemini-nano-banana"],
  label: "Nano Banana",
  generate: async () => ({ providerId: "nano-banana", providerLabel: "Nano Banana", images: [] }),
};

describe("resolveImageProvider", () => {
  test("uses Nano Banana by default", () => {
    // Arrange
    const providers = [nanoBanana];

    // Act
    const provider = resolveImageProvider(providers, undefined);

    // Assert
    expect(provider).toBe(nanoBanana);
  });

  test("matches provider aliases case-insensitively", () => {
    // Arrange
    const providers = [nanoBanana];

    // Act
    const provider = resolveImageProvider(providers, " Gemini-Nano-Banana ");

    // Assert
    expect(provider).toBe(nanoBanana);
  });

  test("returns null for unknown providers", () => {
    // Arrange
    const providers = [nanoBanana];

    // Act
    const provider = resolveImageProvider(providers, "chatgpt");

    // Assert
    expect(provider).toBeNull();
  });
});

describe("listProviderIds", () => {
  test("returns registered provider ids", () => {
    // Arrange
    const providers = [nanoBanana];

    // Act
    const ids = listProviderIds(providers);

    // Assert
    expect(ids).toEqual(["nano-banana"]);
  });
});

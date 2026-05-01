import { describe, expect, test } from "bun:test";
import { normalizeYouTubeConfig } from "./transcript";

describe("normalizeYouTubeConfig", () => {
  test("uses defaults for missing or invalid config values", () => {
    // Arrange
    const raw = { enabled: "yes", preferredModel: " " };

    // Act
    const config = normalizeYouTubeConfig(raw);

    // Assert
    expect(config).toEqual({ enabled: true, preferredModel: "gemini-3-flash-preview" });
  });

  test("normalizes valid config values", () => {
    // Arrange
    const raw = { enabled: false, preferredModel: " gemini-3-pro " };

    // Act
    const config = normalizeYouTubeConfig(raw);

    // Assert
    expect(config).toEqual({ enabled: false, preferredModel: "gemini-3-pro" });
  });
});

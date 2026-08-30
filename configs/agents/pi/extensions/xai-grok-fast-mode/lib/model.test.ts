import { describe, expect, test } from "bun:test";
import { isDirectXaiGrokModel } from "./model";

describe("isDirectXaiGrokModel", () => {
  test("recognizes Grok models on the direct xAI provider", () => {
    // Arrange
    const models = ["grok-4.5", "grok-4.6", "grok-build-0.1"].map((id) => ({ provider: "xai", id }));

    // Act
    const results = models.map(isDirectXaiGrokModel);

    // Assert
    expect(results).toEqual([true, true, true]);
  });

  test("rejects proxy-routed Grok models and non-Grok xAI models", () => {
    // Arrange
    const models = [
      { provider: "openrouter", id: "x-ai/grok-4.6" },
      { provider: "custom-proxy", id: "grok-4.6" },
      { provider: "xai", id: "image-model" },
      undefined,
    ];

    // Act
    const results = models.map(isDirectXaiGrokModel);

    // Assert
    expect(results).toEqual([false, false, false, false]);
  });
});

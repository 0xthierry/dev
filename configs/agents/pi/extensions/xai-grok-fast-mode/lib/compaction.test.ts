import { describe, expect, test } from "bun:test";
import {
  shouldCompactXaiGrok,
  XAI_GROK_AUTO_COMPACTION_THRESHOLD_RATIO,
  xaiGrokCompactionThreshold,
} from "./compaction";

describe("xAI Grok early compaction", () => {
  test("sets the threshold to 85 percent of the model context window", () => {
    // Arrange
    const model = { provider: "xai", id: "grok-4.6", contextWindow: 500_000 };

    // Act
    const threshold = xaiGrokCompactionThreshold(model);

    // Assert
    expect(XAI_GROK_AUTO_COMPACTION_THRESHOLD_RATIO).toBe(0.85);
    expect(threshold).toBe(425_000);
  });

  test("triggers at the threshold but not below it", () => {
    // Arrange
    const model = { provider: "xai", id: "grok-4.6", contextWindow: 500_000 };

    // Act
    const results = [shouldCompactXaiGrok(model, 424_999), shouldCompactXaiGrok(model, 425_000)];

    // Assert
    expect(results).toEqual([false, true]);
  });

  test("does not trigger without a valid direct xAI Grok context window", () => {
    // Arrange
    const models = [
      { provider: "openrouter", id: "x-ai/grok-4.6", contextWindow: 500_000 },
      { provider: "xai", id: "image-model", contextWindow: 500_000 },
      { provider: "xai", id: "grok-4.6" },
      { provider: "xai", id: "grok-4.6", contextWindow: 0 },
    ];

    // Act
    const results = models.map((model) => shouldCompactXaiGrok(model, 500_000));

    // Assert
    expect(results).toEqual([false, false, false, false]);
  });
});

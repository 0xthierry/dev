import { describe, expect, test } from "bun:test";
import { applyXaiGrokFastMode } from "./fast-mode";

describe("applyXaiGrokFastMode", () => {
  test("sets priority processing for direct xAI Grok models", () => {
    // Arrange
    const models = ["grok-4.3", "grok-4.5", "grok-4.6", "grok-build-0.1"].map((id) => ({ provider: "xai", id }));
    const payload = { model: "grok-4.6", input: [], stream: true };

    // Act
    const results = models.map((model) => applyXaiGrokFastMode(payload, model));

    // Assert
    expect(results).toEqual(models.map(() => ({ ...payload, service_tier: "priority" })));
    expect(payload).not.toHaveProperty("service_tier");
  });

  test("leaves an already-priority request unchanged", () => {
    // Arrange
    const payload = { model: "grok-4.6", service_tier: "priority" };
    const model = { provider: "xai", id: "grok-4.6" };

    // Act
    const result = applyXaiGrokFastMode(payload, model);

    // Assert
    expect(result).toBeUndefined();
  });

  test("overrides the standard service tier", () => {
    // Arrange
    const payload = { model: "grok-4.6", service_tier: "default" };
    const model = { provider: "xai", id: "grok-4.6" };

    // Act
    const result = applyXaiGrokFastMode(payload, model);

    // Assert
    expect(result).toEqual({ ...payload, service_tier: "priority" });
  });

  test("does not change Grok requests routed through another provider", () => {
    // Arrange
    const models = [
      { provider: "openrouter", id: "x-ai/grok-4.6" },
      { provider: "custom-proxy", id: "grok-4.6" },
    ];
    const payload = { model: "grok-4.6", input: [] };

    // Act
    const results = models.map((model) => applyXaiGrokFastMode(payload, model));

    // Assert
    expect(results).toEqual([undefined, undefined]);
  });

  test("does not change non-Grok xAI or invalid payloads", () => {
    // Arrange
    const model = { provider: "xai", id: "image-model" };

    // Act
    const results = [
      applyXaiGrokFastMode({}, model),
      applyXaiGrokFastMode("not json", { provider: "xai", id: "grok-4.6" }),
    ];

    // Assert
    expect(results).toEqual([undefined, undefined]);
  });
});

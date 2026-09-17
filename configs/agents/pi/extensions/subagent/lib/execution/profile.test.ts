import { describe, expect, test } from "bun:test";
import { enforceModelEffortPolicy, parseReasoningEffort, readModelReference } from "./profile";

describe("execution profile", () => {
  test("accepts every effort exactly without clamping", () => {
    // Arrange
    const values = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

    // Act
    const parsed = values.map(parseReasoningEffort);

    // Assert
    expect(parsed).toEqual([...values]);
    expect(parseReasoningEffort("HIGH")).toBeUndefined();
  });

  test("enforces high with policy provenance for xAI Grok 4.5", () => {
    // Arrange
    const execution = {
      profile: { provider: "xai", model: "grok-4.5", effort: "low" as const },
      source: { model: "parent" as const, effort: "parent" as const },
    };

    // Act
    const normalized = enforceModelEffortPolicy(execution);

    // Assert
    expect(normalized).toEqual({
      profile: { provider: "xai", model: "grok-4.5", effort: "high" },
      source: { model: "parent", effort: "policy" },
    });
  });

  test("leaves other model executions unchanged", () => {
    // Arrange
    const execution = {
      profile: { provider: "cliproxyapi", model: "gpt-5.6-sol", effort: "low" as const },
      source: { model: "agent" as const, effort: "agent" as const },
    };

    // Act
    const normalized = enforceModelEffortPolicy(execution);

    // Assert
    expect(normalized).toBe(execution);
  });

  test("requires provider and model atomically", () => {
    // Arrange
    const incomplete = { provider: "openai-codex" };

    // Act
    const result = readModelReference(incomplete);

    // Assert
    expect(result).toEqual({ ok: false, error: { kind: "incomplete_model_reference" } });
  });
});

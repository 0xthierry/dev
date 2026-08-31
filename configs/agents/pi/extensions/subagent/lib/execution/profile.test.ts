import { describe, expect, test } from "bun:test";
import { parseReasoningEffort, readModelReference } from "./profile";

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

  test("requires provider and model atomically", () => {
    // Arrange
    const incomplete = { provider: "openai-codex" };

    // Act
    const result = readModelReference(incomplete);

    // Assert
    expect(result).toEqual({ ok: false, error: { kind: "incomplete_model_reference" } });
  });
});

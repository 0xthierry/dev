import { describe, expect, test } from "bun:test";
import { applyCodexDetailedReasoning } from "./payload";

describe("applyCodexDetailedReasoning", () => {
  for (const model of ["gpt-5.4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const) {
    test(`upgrades auto reasoning summaries to detailed on eligible ${model} Codex payloads`, () => {
      // Arrange
      const payload = codexPayload({ model });

      // Act
      const result = applyCodexDetailedReasoning(payload);

      // Assert
      expect(result).toEqual({ ...payload, reasoning: { effort: "high", summary: "detailed" } });
      expect((payload.reasoning as Record<string, unknown>).summary).toBe("auto");
    });
  }

  test("leaves already-detailed payloads unchanged", () => {
    // Arrange
    const payload = codexPayload({ reasoning: { effort: "high", summary: "detailed" } });

    // Act
    const result = applyCodexDetailedReasoning(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("preserves other reasoning fields when rewriting the summary", () => {
    // Arrange
    const payload = codexPayload({ reasoning: { effort: "xhigh", summary: "auto" } });

    // Act
    const result = applyCodexDetailedReasoning(payload);

    // Assert
    expect(result?.reasoning).toEqual({ effort: "xhigh", summary: "detailed" });
  });

  test("does not touch payloads without a reasoning summary", () => {
    // Arrange
    const payload = codexPayload({ reasoning: { effort: "high" } });

    // Act
    const result = applyCodexDetailedReasoning(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("does not touch unsupported Codex models", () => {
    // Arrange
    const payload = codexPayload({ model: "gpt-5.4-mini" });

    // Act
    const result = applyCodexDetailedReasoning(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("does not change non-Codex OpenAI responses payloads", () => {
    // Arrange
    const payload = {
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      store: false,
      reasoning: { effort: "high", summary: "auto" },
    };

    // Act
    const result = applyCodexDetailedReasoning(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("does not change non-object payloads", () => {
    // Arrange
    const payload = "not json";

    // Act
    const result = applyCodexDetailedReasoning(payload);

    // Assert
    expect(result).toBeUndefined();
  });
});

function codexPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: "gpt-5.6-sol",
    store: false,
    stream: true,
    instructions: "You are a helpful assistant.",
    input: [],
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: "session-id",
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: { effort: "high", summary: "auto" },
    ...overrides,
  };
}

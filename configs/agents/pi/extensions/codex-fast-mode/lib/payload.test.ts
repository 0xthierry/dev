import { describe, expect, test } from "bun:test";
import { applyCodexFastMode } from "./payload";

describe("applyCodexFastMode", () => {
  for (const model of ["gpt-5.4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const) {
    test(`sets priority service tier on eligible ${model} Codex payloads`, () => {
      // Arrange
      const payload = codexPayload({ model });

      // Act
      const result = applyCodexFastMode(payload);

      // Assert
      expect(result).toEqual({ ...payload, service_tier: "priority" });
      expect(payload).not.toHaveProperty("service_tier");
    });
  }

  test("leaves already-priority payloads unchanged", () => {
    // Arrange
    const payload = codexPayload({ service_tier: "priority" });

    // Act
    const result = applyCodexFastMode(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  for (const model of ["gpt-5.4-mini", "gpt-6-astra"] as const) {
    test(`does not opt unsupported ${model} Codex payloads into fast mode`, () => {
      // Arrange
      const payload = codexPayload({ model });

      // Act
      const result = applyCodexFastMode(payload);

      // Assert
      expect(result).toBeUndefined();
    });
  }

  test("does not change non-Codex OpenAI responses payloads", () => {
    // Arrange
    const payload = {
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      store: false,
    };

    // Act
    const result = applyCodexFastMode(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("does not change non-object payloads", () => {
    // Arrange
    const payload = "not json";

    // Act
    const result = applyCodexFastMode(payload);

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
    ...overrides,
  };
}

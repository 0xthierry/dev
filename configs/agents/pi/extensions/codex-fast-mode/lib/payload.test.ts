import { describe, expect, test } from "bun:test";
import { applyCodexFastMode } from "./payload";

describe("applyCodexFastMode", () => {
  test("sets priority service tier on eligible GPT-5.5 Codex payloads", () => {
    // Arrange
    const payload = codexPayload({ model: "gpt-5.5" });

    // Act
    const result = applyCodexFastMode(payload);

    // Assert
    expect(result).toEqual({ ...payload, service_tier: "priority" });
    expect(payload).not.toHaveProperty("service_tier");
  });

  test("sets priority service tier on eligible GPT-5.4 Codex payloads", () => {
    // Arrange
    const payload = codexPayload({ model: "gpt-5.4" });

    // Act
    const result = applyCodexFastMode(payload);

    // Assert
    expect(result).toEqual({ ...payload, service_tier: "priority" });
  });

  test("leaves already-priority payloads unchanged", () => {
    // Arrange
    const payload = codexPayload({ service_tier: "priority" });

    // Act
    const result = applyCodexFastMode(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("does not opt unsupported Codex models into fast mode", () => {
    // Arrange
    const payload = codexPayload({ model: "gpt-5.4-mini" });

    // Act
    const result = applyCodexFastMode(payload);

    // Assert
    expect(result).toBeUndefined();
  });

  test("does not change non-Codex OpenAI responses payloads", () => {
    // Arrange
    const payload = {
      model: "gpt-5.5",
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
    model: "gpt-5.5",
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

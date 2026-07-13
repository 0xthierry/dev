import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerPersonalityExtension } from "./register";

const PERSONALITY = `You are a pragmatic, effective software engineer.
You take engineering quality seriously and use a direct, factual and
brief communication style with the user without unnecessary detail.`;

const openAiModels = [
  { provider: "openai", id: "gpt-4.1" },
  { provider: "openai-codex", id: "gpt-5.6-sol" },
];

describe("registerPersonalityExtension", () => {
  test("appends the personality prompt for every OpenAI provider", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerPersonalityExtension(fakePi.pi);

    // Act
    const results = await Promise.all(
      openAiModels.map((model) => fakePi.emit("before_agent_start", { systemPrompt: "base prompt" }, { model })),
    );

    // Assert
    expect(results).toEqual(
      openAiModels.map(() => [
        {
          systemPrompt: `base prompt\n\n${PERSONALITY}`,
        },
      ]),
    );
  });

  test("leaves non-OpenAI models unchanged", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerPersonalityExtension(fakePi.pi);

    // Act
    const results = await fakePi.emit(
      "before_agent_start",
      { systemPrompt: "base prompt" },
      { model: { provider: "anthropic", id: "claude-sonnet-4-6" } },
    );

    // Assert
    expect(results).toEqual([]);
  });

  test("leaves the prompt unchanged when no model is selected", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerPersonalityExtension(fakePi.pi);

    // Act
    const results = await fakePi.emit("before_agent_start", { systemPrompt: "base prompt" });

    // Assert
    expect(results).toEqual([]);
  });
});

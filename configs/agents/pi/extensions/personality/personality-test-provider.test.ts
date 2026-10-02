import { describe, expect, test } from "bun:test";
import { type Api, type Model, normalizeContext } from "@earendil-works/pi-ai";
import { streamSimple } from "./personality-test-provider";

const model: Model<Api> = {
  id: "personality-unit-model",
  name: "Personality Unit Model",
  api: "personality-e2e-api",
  provider: "openai",
  baseUrl: "http://localhost:0",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 1_024,
};

describe("personality test provider", () => {
  test("echoes the effective prompt after transcript additions and section patches", async () => {
    // Arrange
    const context = normalizeContext({
      messages: [
        {
          role: "system",
          content: "Base instructions",
          sections: { personality: "Stale personality", removed: "Discard this section" },
          timestamp: 0,
        },
        { role: "user", content: "Do not echo user text", timestamp: 1 },
        {
          role: "system",
          content: "Additional instructions",
          sections: { personality: "Effective personality", removed: null },
          timestamp: 2,
        },
      ],
    });

    // Act
    const message = await streamSimple(model, context).result();

    // Assert
    expect(message.content).toEqual([
      { type: "text", text: "Base instructions\n\nAdditional instructions\n\nEffective personality" },
    ]);
    expect(message.stopReason).toBe("stop");
    expect(message.provider).toBe("openai");
    expect(message.model).toBe("personality-unit-model");
  });

  test("emits an empty successful response when the transcript has no system prompt", async () => {
    // Arrange
    const context = normalizeContext({
      messages: [{ role: "user", content: "Do not echo user text", timestamp: 0 }],
    });

    // Act
    const message = await streamSimple(model, context).result();

    // Assert
    expect(message.content).toEqual([{ type: "text", text: "" }]);
    expect(message.stopReason).toBe("stop");
  });
});

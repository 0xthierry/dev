import { describe, expect, test } from "bun:test";
import { createCodexMultiAuthProviderConfig } from "./provider";

describe("createCodexMultiAuthProviderConfig", () => {
  test("preserves the Codex catalog while routing it through the standard Responses bridge", async () => {
    // Arrange
    const bridgeBaseUrl = "http://127.0.0.1:43210/v1";

    // Act
    const config = await createCodexMultiAuthProviderConfig({
      bridgeBaseUrl,
      bridgeClientApiKey: "local-secret",
    });

    // Assert
    expect(config).toMatchObject({
      name: "OpenAI Codex (multi-account)",
      baseUrl: bridgeBaseUrl,
      apiKey: "local-secret",
      api: "openai-responses",
    });
    expect(config.models?.length).toBeGreaterThan(0);
    expect(config.models?.every((model) => model.api === undefined && model.baseUrl === undefined)).toBe(true);
    expect(config.models?.some((model) => model.id === "gpt-5.6-sol")).toBe(true);
    expect(config.models?.every((model) => model.name.endsWith("(multi-account)"))).toBe(true);
  });
});

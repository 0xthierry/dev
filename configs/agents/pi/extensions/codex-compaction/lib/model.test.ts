import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  codexAutoCompactionThreshold,
  codexReasoningEffort,
  extractChatGptAccountId,
  isCodexResponsesModel,
  resolveCodexResponsesUrl,
  resolveCompactionUrl,
} from "./model";
import type { CodexModel } from "./types";

const model = {
  id: "gpt-5.4-mini",
  provider: "openai-codex",
  api: "openai-codex-responses",
  reasoning: true,
  thinkingLevelMap: { minimal: "low", xhigh: "xhigh" },
} as CodexModel;

describe("codex model helpers", () => {
  test("recognizes GPT-5.5 and GPT-5.6 Codex response models", () => {
    // Arrange
    const models = [
      { id: "gpt-5.5", provider: "openai-codex", api: "openai-codex-responses" },
      { id: "gpt-5.6-sol", provider: "openai-codex", api: "openai-codex-responses" },
      { id: "gpt-5.6-terra", provider: "openai-codex", api: "openai-codex-responses" },
      { id: "gpt-5.6-luna", provider: "openai-codex", api: "openai-codex-responses" },
    ] as CodexModel[];

    // Act
    const supported = models.map(isCodexResponsesModel);

    // Assert
    expect(supported).toEqual([true, true, true, true]);
  });

  test("accepts only the CLIProxyAPI Responses combination beyond direct Codex", () => {
    // Arrange
    const proxy: CodexModel = {
      ...model,
      provider: "cliproxyapi",
      api: "openai-responses",
      baseUrl: "http://127.0.0.1:8317/v1/",
    };
    const arbitraryOpenAI: Model<Api> = { ...proxy, provider: "openai" };
    const proxyChat: Model<Api> = { ...proxy, api: "openai-completions" };

    // Act
    const accepted = isCodexResponsesModel(proxy);
    const rejectedProvider = isCodexResponsesModel(arbitraryOpenAI);
    const rejectedApi = isCodexResponsesModel(proxyChat);
    const endpoint = resolveCompactionUrl(proxy);

    // Assert
    expect(accepted).toBe(true);
    expect(rejectedProvider).toBe(false);
    expect(rejectedApi).toBe(false);
    expect(endpoint).toBe("http://127.0.0.1:8317/v1/responses");
  });

  test("derives the native Codex 90% auto-compaction threshold from the model context window", () => {
    // Arrange
    const codexModel = { ...model, contextWindow: 272_000 } as CodexModel;

    // Act
    const threshold = codexAutoCompactionThreshold(codexModel);

    // Assert
    expect(threshold).toBe(244_800);
  });

  test("maps unsupported minimal reasoning to the model's configured effort", () => {
    // Arrange
    const thinkingLevel = "minimal";

    // Act
    const effort = codexReasoningEffort(model, thinkingLevel);

    // Assert
    expect(effort).toBe("low");
  });

  test("resolves Codex response URLs from backend base URLs", () => {
    // Arrange
    const urls = ["https://chatgpt.com/backend-api", "https://chatgpt.com/backend-api/codex"];

    // Act
    const resolved = urls.map(resolveCodexResponsesUrl);

    // Assert
    expect(resolved).toEqual([
      "https://chatgpt.com/backend-api/codex/responses",
      "https://chatgpt.com/backend-api/codex/responses",
    ]);
  });

  test("extracts account id from ChatGPT OAuth JWT claims", () => {
    // Arrange
    const payload = Buffer.from(
      JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } }),
      "utf8",
    ).toString("base64url");
    const token = `header.${payload}.signature`;

    // Act
    const accountId = extractChatGptAccountId(token);

    // Assert
    expect(accountId).toBe("acct_123");
  });
});

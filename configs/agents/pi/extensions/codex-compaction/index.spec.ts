import { describe, expect, test } from "bun:test";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { fetchCodexCompaction } from "./lib/codex-client";
import { extractChatGptAccountId, isCodexResponsesModel } from "./lib/model";

describe("codex-compaction live contract", () => {
  test("Codex backend returns an opaque compaction item for a compaction trigger", async () => {
    // Arrange
    const registry = ModelRegistry.create(AuthStorage.create());
    const model = registry.find("openai-codex", "gpt-5.4-mini") ?? registry.getAll().find(isCodexResponsesModel);
    if (!isCodexResponsesModel(model)) throw new Error("No openai-codex model is available");

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey)
      throw new Error(`No openai-codex auth available: ${auth.ok ? "missing token" : auth.error}`);

    const accountId = extractChatGptAccountId(auth.apiKey);
    if (!accountId) throw new Error("openai-codex auth did not contain a ChatGPT account id");

    // Act
    const result = await fetchCodexCompaction({
      model,
      apiKey: auth.apiKey,
      headers: auth.headers,
      accountId,
      systemPrompt: "You are a concise coding assistant.",
      input: [{ role: "user", content: "Remember marker PI-CODEX-COMPACTION-LIVE." }],
      thinkingLevel: "low",
    });

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.type).toBe("compaction");
      expect(result.item.encrypted_content.length).toBeGreaterThan(0);
    }
  }, 90_000);
});

import { describe, expect, test } from "bun:test";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { resolveCodexIdentity } from "./lib/binding";
import { fetchCodexCompaction } from "./lib/codex-client";
import { isCodexResponsesModel } from "./lib/model";

describe("codex-compaction live contract", () => {
  test("Codex backend returns an opaque compaction item for a compaction trigger", async () => {
    // Arrange
    const registry = new ModelRegistry(await ModelRuntime.create());
    const model =
      registry.find("openai-codex", "gpt-5.6-sol") ??
      registry.find("openai-codex", "gpt-5.5") ??
      registry.find("openai-codex", "gpt-5.4-mini") ??
      registry.getAll().find((candidate) => candidate.api === "openai-codex-responses");
    if (!isCodexResponsesModel(model) || model.api !== "openai-codex-responses")
      throw new Error("No openai-codex model is available");

    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok || !auth.apiKey)
      throw new Error(`No openai-codex auth available: ${auth.ok ? "missing token" : auth.error}`);

    const identity = resolveCodexIdentity(model, auth);
    if (!identity || identity.kind !== "direct")
      throw new Error("openai-codex auth did not contain a ChatGPT account id");

    // Act
    const result = await fetchCodexCompaction({
      model,
      identity,
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

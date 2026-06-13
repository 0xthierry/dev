import { describe, expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { injectCodexCompactionIntoPayload } from "./payload";
import { CODEX_COMPACTION_DETAILS_VERSION, type CodexCompactionDetails } from "./types";

const model = {
  id: "gpt-5.4-mini",
  provider: "openai-codex",
  api: "openai-codex-responses",
  name: "GPT-5.4 mini",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 32000,
} as Model<Api>;

function compactionEntry(): SessionEntry {
  const details: CodexCompactionDetails = {
    codexCompaction: {
      version: CODEX_COMPACTION_DETAILS_VERSION,
      sentinel: "pi-codex-compaction:test",
      provider: "openai-codex",
      api: "openai-codex-responses",
      modelId: "gpt-5.4-mini",
      item: { type: "compaction", encrypted_content: "enc", id: "cmp_1" },
    },
  };

  return {
    type: "compaction",
    id: "cmp-entry",
    parentId: "parent",
    timestamp: new Date(0).toISOString(),
    summary: "placeholder pi-codex-compaction:test",
    firstKeptEntryId: "kept",
    tokensBefore: 123,
    details,
  };
}

describe("injectCodexCompactionIntoPayload", () => {
  test("replaces the sentinel summary item with the Codex compaction item", () => {
    // Arrange
    const payload: { input: Record<string, unknown>[] } = {
      input: [
        { role: "user", content: [{ type: "input_text", text: "before pi-codex-compaction:test after" }] },
        { role: "user", content: "tail" },
      ],
    };

    // Act
    const result = injectCodexCompactionIntoPayload(payload, model, [compactionEntry()]);

    // Assert
    expect(result).toEqual({ injected: true, sentinel: "pi-codex-compaction:test" });
    expect(payload.input[0]).toEqual({ type: "compaction", encrypted_content: "enc", id: "cmp_1" });
    expect(payload.input[1]).toEqual({ role: "user", content: "tail" });
  });

  test("does not inject when the stored item was invalidated", () => {
    // Arrange
    const payload: { input: Record<string, unknown>[] } = {
      input: [{ role: "user", content: "pi-codex-compaction:test" }],
    };
    const invalidation: SessionEntry = {
      type: "custom",
      id: "invalidate",
      parentId: "cmp-entry",
      timestamp: new Date(1).toISOString(),
      customType: "codex-compaction-invalidated",
      data: { sentinel: "pi-codex-compaction:test", status: 400 },
    };

    // Act
    const result = injectCodexCompactionIntoPayload(payload, model, [compactionEntry(), invalidation]);

    // Assert
    expect(result).toEqual({ injected: false, reason: "invalidated" });
    expect(payload.input[0]).toEqual({ role: "user", content: "pi-codex-compaction:test" });
  });
});

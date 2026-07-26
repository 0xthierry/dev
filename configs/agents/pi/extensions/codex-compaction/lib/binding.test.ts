import { describe, expect, test } from "bun:test";
import { bindingsEqual, createBinding, hashAccountId, isCompatibleV2Binding, normalizeEndpoint } from "./binding";
import type { CodexCompactionV2, CodexModel } from "./types";

const model = {
  id: "gpt-5.6-sol",
  provider: "openai-codex",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
} as CodexModel;

describe("binding", () => {
  test("hashes account ids without retaining the raw value", () => {
    // Arrange
    const accountId = "acct_secret_123";

    // Act
    const hash = hashAccountId(accountId);

    // Assert
    expect(hash).toHaveLength(16);
    expect(hash).not.toContain("acct_");
    expect(hash).not.toContain(accountId);
  });

  test("normalizes endpoints and compares bindings exactly", () => {
    // Arrange
    const left = createBinding(model, "acct_a");
    const right = createBinding(
      { ...model, baseUrl: "https://chatgpt.com/backend-api/codex/" } as CodexModel,
      "acct_a",
    );
    const otherAccount = createBinding(model, "acct_b");
    const otherModel = createBinding({ ...model, id: "gpt-5.5" } as CodexModel, "acct_a");

    // Act / Assert
    expect(normalizeEndpoint(model.baseUrl)).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(bindingsEqual(left, right)).toBe(true);
    expect(bindingsEqual(left, otherAccount)).toBe(false);
    expect(bindingsEqual(left, otherModel)).toBe(false);
  });

  test("compatibility requires model endpoint and account hash match", () => {
    // Arrange
    const record = {
      version: 2,
      binding: createBinding(model, "acct_a"),
      userPrefix: [],
      artifact: [{ type: "compaction", encrypted_content: "enc" }],
      firstKeptEntryId: "kept",
      tokensBefore: 1,
    } as CodexCompactionV2;

    // Act
    const ok = isCompatibleV2Binding(record, model, hashAccountId("acct_a"));
    const badAccount = isCompatibleV2Binding(record, model, hashAccountId("acct_b"));
    const badModel = isCompatibleV2Binding(record, { ...model, id: "other" }, hashAccountId("acct_a"));

    // Assert
    expect(ok).toBe(true);
    expect(badAccount).toBe(false);
    expect(badModel).toBe(false);
  });
});

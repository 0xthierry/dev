import { describe, expect, test } from "bun:test";
import { bindingsEqual, resolveCodexIdentity } from "./binding";
import type { CodexModel } from "./types";

const model: CodexModel = {
  id: "gpt-5.6-sol",
  name: "sol",
  provider: "openai-codex",
  api: "openai-codex-responses",
  baseUrl: "https://chatgpt.com/backend-api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 32000,
};
const proxyModel: CodexModel = {
  ...model,
  provider: "cliproxyapi",
  api: "openai-responses",
  baseUrl: "http://127.0.0.1:8317/v1",
};

function directIdentity(accountId: string, target = model) {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
  ).toString("base64url");
  const identity = resolveCodexIdentity(target, { apiKey: `header.${payload}.signature` });
  if (!identity) throw new Error("Expected direct test identity");
  return identity;
}

function proxyIdentity(apiKey: string, target = proxyModel) {
  const identity = resolveCodexIdentity(target, { apiKey });
  if (!identity) throw new Error("Expected proxy test identity");
  return identity;
}

describe("binding", () => {
  test("retains the direct v2 account hash format and normalizes its endpoint", () => {
    // Arrange
    const original = directIdentity("acct_a");
    const normalized = directIdentity("acct_a", { ...model, baseUrl: "https://chatgpt.com/backend-api/codex/" });

    // Act
    const matches = bindingsEqual(original.binding, normalized.binding);

    // Assert
    expect(matches).toBe(true);
    expect(original.binding).toEqual({
      provider: "openai-codex",
      api: "openai-codex-responses",
      modelId: "gpt-5.6-sol",
      endpoint: "https://chatgpt.com/backend-api/codex/responses",
      accountHash: "c1383c10f6fe17fb",
    });
    expect(JSON.stringify(original.binding)).not.toContain("acct_a");
  });

  test("rejects a changed direct account and a non-JWT direct credential", () => {
    // Arrange
    const original = directIdentity("acct_a");

    // Act
    const same = bindingsEqual(original.binding, directIdentity("acct_a").binding);
    const changed = bindingsEqual(original.binding, directIdentity("acct_b").binding);
    const invalid = resolveCodexIdentity(model, { apiKey: "local-key" });

    // Assert
    expect(same).toBe(true);
    expect(changed).toBe(false);
    expect(invalid).toBeUndefined();
  });

  test("binds proxy artifacts to the proxy boundary without inventing an account", () => {
    // Arrange
    const original = proxyIdentity("local-key");

    // Act
    const normalized = proxyIdentity("local-key", { ...proxyModel, baseUrl: "http://127.0.0.1:8317/v1/" });

    // Assert
    expect(bindingsEqual(original.binding, normalized.binding)).toBe(true);
    expect(original.binding).toEqual({
      scope: "proxy",
      provider: "cliproxyapi",
      api: "openai-responses",
      modelId: "gpt-5.6-sol",
      endpoint: "http://127.0.0.1:8317/v1/responses",
      proxyKeyHash: "dba73d3fcb67907054ce8317378a14b30da1b86b75803e9ba66f18efd9bef09e", // gitleaks:allow -- SHA256 of synthetic "local-key" fixture
    });
    expect(original.kind).toBe("proxy");
    expect(JSON.stringify(original.binding)).not.toContain("local-key");
  });

  test("rejects changed proxy credentials, endpoints, models and providers", () => {
    // Arrange
    const original = proxyIdentity("local-key").binding;

    // Act
    const changedKey = bindingsEqual(original, proxyIdentity("other-key").binding);
    const changedEndpoint = bindingsEqual(
      original,
      proxyIdentity("local-key", { ...proxyModel, baseUrl: "http://127.0.0.1:8318/v1" }).binding,
    );
    const changedModel = bindingsEqual(original, { ...original, modelId: "other" });
    const changedProvider = bindingsEqual(original, { ...original, provider: "other" });
    const noAuth = bindingsEqual(original, undefined);

    // Assert
    expect(changedKey).toBe(false);
    expect(changedEndpoint).toBe(false);
    expect(changedModel).toBe(false);
    expect(changedProvider).toBe(false);
    expect(noAuth).toBe(false);
    expect(bindingsEqual(original, proxyIdentity("local-key").binding)).toBe(true);
  });
});

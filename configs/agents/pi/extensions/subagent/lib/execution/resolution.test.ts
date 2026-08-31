import { describe, expect, mock, test } from "bun:test";
import type { CatalogModel, ModelCatalog } from "./resolution";
import { resolveAgentExecution, resolveAndValidateAgentExecution } from "./resolution";

const parent = { provider: "anthropic", model: "sonnet", effort: "medium" as const };

function catalog(): ModelCatalog {
  return {
    hasProvider: mock((provider) => ["anthropic", "openai-codex", "xai"].includes(provider)),
    findModel: mock((provider, model): CatalogModel | undefined =>
      provider === "openai-codex" && model === "gpt"
        ? { provider, model, supportedEfforts: ["low", "high", "xhigh"] }
        : provider === "anthropic" && model === "sonnet"
          ? { provider, model, supportedEfforts: ["medium", "high"] }
          : undefined,
    ),
    canAuthenticate: mock((provider) => provider !== "xai"),
  };
}

describe("resolveAgentExecution", () => {
  test("resolves model and effort independently by precedence", () => {
    // Arrange
    const input = {
      parent,
      agent: { provider: "anthropic", model: "sonnet", effort: "low" as const },
      repository: { provider: "xai", model: "grok", effort: "high" as const },
      invocation: { provider: "openai-codex", model: "gpt" },
    };

    // Act
    const result = resolveAgentExecution(input);

    // Assert
    expect(result).toEqual({
      ok: true,
      value: {
        profile: { provider: "openai-codex", model: "gpt", effort: "high" },
        source: { model: "invocation", effort: "repository" },
      },
    });
  });

  test("returns a typed error for a differing locked override", () => {
    // Arrange
    const input = {
      parent,
      repository: {
        provider: "anthropic",
        model: "sonnet",
        effort: "high" as const,
        allowInvocationOverride: { model: false, effort: false },
      },
      invocation: { effort: "low" as const },
    };

    // Act
    const result = resolveAgentExecution(input);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: { kind: "override_locked", field: "effort", requested: "low", configured: "high" },
    });
  });

  test("retains repository provenance for identical locked overrides", () => {
    // Arrange
    const input = {
      parent,
      repository: {
        provider: "openai-codex",
        model: "gpt",
        effort: "max" as const,
        allowInvocationOverride: { model: false, effort: false },
      },
      invocation: { provider: "openai-codex", model: "gpt", effort: "max" as const },
    };

    // Act
    const result = resolveAgentExecution(input);

    // Assert
    expect(result).toEqual({
      ok: true,
      value: {
        profile: { provider: "openai-codex", model: "gpt", effort: "max" },
        source: { model: "repository", effort: "repository" },
      },
    });
  });
});

describe("resolveAndValidateAgentExecution", () => {
  test("validates the resolved pair and effort through the complete catalog", () => {
    // Arrange
    const input = { parent, invocation: { provider: "openai-codex", model: "gpt", effort: "max" as const } };

    // Act
    const result = resolveAndValidateAgentExecution(input, catalog());

    // Assert
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "unsupported_effort",
        provider: "openai-codex",
        model: "gpt",
        requested: "max",
        supported: ["low", "high", "xhigh"],
      },
    });
  });

  test("distinguishes unknown providers from unknown models", () => {
    // Arrange
    const unknownProvider = { parent, invocation: { provider: "missing", model: "gpt" } };
    const unknownModel = { parent, invocation: { provider: "openai-codex", model: "missing" } };

    // Act
    const providerResult = resolveAndValidateAgentExecution(unknownProvider, catalog());
    const modelResult = resolveAndValidateAgentExecution(unknownModel, catalog());

    // Assert
    expect(providerResult).toEqual({ ok: false, error: { kind: "unknown_provider", provider: "missing" } });
    expect(modelResult).toEqual({
      ok: false,
      error: { kind: "unknown_model", provider: "openai-codex", model: "missing" },
    });
  });
});

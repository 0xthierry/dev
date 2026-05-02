import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SearchResponse } from "../types";
import { defaultSearchProviders, type SearchProvider, searchWithProviderChain } from "./orchestrator";

const exaResponse: SearchResponse = {
  answer: "exa answer",
  provider: "exa",
  results: [{ title: "Exa", url: "https://exa.test", snippet: "" }],
};

const braveResponse: SearchResponse = {
  answer: "brave answer",
  provider: "brave",
  results: [{ title: "Brave", url: "https://brave.test", snippet: "" }],
};

const codexResponse: SearchResponse = {
  answer: "codex answer",
  provider: "codex",
  results: [{ title: "Codex", url: "https://codex.test", snippet: "" }],
};

function provider(name: string, response: SearchResponse, available = true): SearchProvider {
  return {
    name,
    unavailableMessage: `${name}: unavailable`,
    isAvailable: mock(() => available),
    search: mock(async () => response),
  };
}

afterEach(() => {
  mock.clearAllMocks();
});

describe("defaultSearchProviders", () => {
  test("uses the configured provider priority order", () => {
    // Arrange / Act
    const names = defaultSearchProviders().map((provider) => provider.name);

    // Assert
    expect(names).toEqual(["Exa", "Brave", "Tavily", "Codex"]);
  });
});

describe("searchWithProviderChain", () => {
  test("uses Exa first when configured", async () => {
    // Arrange
    const exa = provider("Exa", exaResponse);
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [exa, codex]);

    // Assert
    expect(result).toBe(exaResponse);
    expect(exa.isAvailable).toHaveBeenCalledTimes(1);
    expect(exa.search).toHaveBeenCalledWith("query", {});
    expect(codex.search).not.toHaveBeenCalled();
  });

  test("falls back to the next configured provider when Exa is not configured", async () => {
    // Arrange
    const exa = provider("Exa", exaResponse, false);
    const brave = provider("Brave", braveResponse);
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [exa, brave, codex]);

    // Assert
    expect(result).toBe(braveResponse);
    expect(exa.search).not.toHaveBeenCalled();
    expect(brave.search).toHaveBeenCalledWith("query", {});
    expect(codex.search).not.toHaveBeenCalled();
  });

  test("falls back to later providers when earlier providers fail or are rate limited", async () => {
    // Arrange
    const exa = provider("Exa", exaResponse);
    exa.search = mock(async () => Promise.reject(new Error("Exa API rate limit exceeded (429)")));
    const brave = provider("Brave", braveResponse);
    brave.search = mock(async () => Promise.reject(new Error("Brave Search API rate limit exceeded (429)")));
    const tavilyResponse: SearchResponse = { ...codexResponse, provider: "tavily" };
    const tavily = provider("Tavily", tavilyResponse);
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [exa, brave, tavily, codex]);

    // Assert
    expect(result).toBe(tavilyResponse);
    expect(tavily.search).toHaveBeenCalledWith("query", {});
    expect(codex.search).not.toHaveBeenCalled();
  });

  test("falls back when a provider returns no source URLs", async () => {
    // Arrange
    const emptyExa = provider("Exa", { answer: "", provider: "exa", results: [] });
    const brave = provider("Brave", braveResponse);
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [emptyExa, brave, codex]);

    // Assert
    expect(result).toBe(braveResponse);
    expect(brave.search).toHaveBeenCalledWith("query", {});
    expect(codex.search).not.toHaveBeenCalled();
  });

  test("throws an aggregated error when all providers return no source URLs", async () => {
    // Arrange
    const emptyExa = provider("Exa", { answer: "", provider: "exa", results: [] });
    const emptyCodex = provider("Codex", { answer: "answer without links", provider: "codex", results: [] });

    // Act / Assert
    await expect(searchWithProviderChain("query", {}, [emptyExa, emptyCodex])).rejects.toThrow(
      "Web search failed:\n  - Exa: returned no answer or source URLs\n  - Codex: returned no source URLs",
    );
  });

  test("throws aggregated provider errors", async () => {
    // Arrange
    const providers = [
      { ...provider("Exa", exaResponse), search: mock(async () => Promise.reject(new Error("exa unavailable"))) },
      {
        ...provider("Codex", codexResponse),
        search: mock(async () => Promise.reject(new Error("codex unavailable"))),
      },
    ];

    // Act / Assert
    await expect(searchWithProviderChain("query", {}, providers)).rejects.toThrow("Web search failed");
  });

  test("does not swallow abort errors", async () => {
    // Arrange
    const providers = [
      { ...provider("Exa", exaResponse), search: mock(async () => Promise.reject(new Error("Aborted"))) },
    ];

    // Act / Assert
    await expect(searchWithProviderChain("query", {}, providers)).rejects.toThrow("Aborted");
  });
});

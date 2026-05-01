import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SearchResponse } from "../types";
import { type SearchProvider, searchWithProviderChain } from "./orchestrator";

const exaResponse: SearchResponse = {
  answer: "exa answer",
  provider: "exa",
  results: [{ title: "Exa", url: "https://exa.test", snippet: "" }],
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

  test("falls back to Codex when Exa is not configured", async () => {
    // Arrange
    const exa = provider("Exa", exaResponse, false);
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [exa, codex]);

    // Assert
    expect(result).toBe(codexResponse);
    expect(exa.search).not.toHaveBeenCalled();
    expect(codex.search).toHaveBeenCalledWith("query", {});
  });

  test("falls back to Codex when Exa fails", async () => {
    // Arrange
    const exa = provider("Exa", exaResponse);
    exa.search = mock(async () => Promise.reject(new Error("exa unavailable")));
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [exa, codex]);

    // Assert
    expect(result).toBe(codexResponse);
  });

  test("falls back when a provider returns no source URLs", async () => {
    // Arrange
    const emptyExa = provider("Exa", { answer: "", provider: "exa", results: [] });
    const codex = provider("Codex", codexResponse);

    // Act
    const result = await searchWithProviderChain("query", {}, [emptyExa, codex]);

    // Assert
    expect(result).toBe(codexResponse);
    expect(codex.search).toHaveBeenCalledWith("query", {});
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
    await expect(
      searchWithProviderChain("query", {}, [
        { ...provider("Exa", exaResponse), search: mock(async () => Promise.reject(new Error("exa unavailable"))) },
        {
          ...provider("Codex", codexResponse),
          search: mock(async () => Promise.reject(new Error("codex unavailable"))),
        },
      ]),
    ).rejects.toThrow("Web search failed");
  });

  test("does not swallow abort errors", async () => {
    await expect(
      searchWithProviderChain("query", {}, [
        { ...provider("Exa", exaResponse), search: mock(async () => Promise.reject(new Error("Aborted"))) },
      ]),
    ).rejects.toThrow("Aborted");
  });
});

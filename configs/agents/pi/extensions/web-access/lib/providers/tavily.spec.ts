import { describe, expect, test } from "bun:test";
import { fetchWithTavilyExtract, searchWithTavily } from "./tavily";

describe("web-access Tavily live contract", () => {
  test("validates Tavily Search and Extract contracts", async () => {
    // Arrange
    if (!process.env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is required for this live Tavily contract spec.");

    // Act
    const search = await searchWithTavily("Tavily API documentation", { numResults: 2, includeContent: true });
    const content = await fetchWithTavilyExtract("https://example.com", undefined);

    // Assert
    expect(search.provider).toBe("tavily");
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results[0]?.url).toStartWith("http");
    expect(content?.provider).toBe("tavily");
    expect(content?.content.length ?? 0).toBeGreaterThan(20);
  }, 90_000);
});

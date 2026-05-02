import { describe, expect, test } from "bun:test";
import { searchWithBrave } from "./brave";

const BRAVE_WEB_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

async function searchWithBraveWebEndpoint(query: string): Promise<{ resultCount: number; snippetChars: number }> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error("BRAVE_API_KEY is required for this live Brave contract spec.");

  const url = new URL(BRAVE_WEB_SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("result_filter", "web");
  url.searchParams.set("text_decorations", "false");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Brave Web Search contract failed with HTTP ${response.status}`);
  const data = (await response.json()) as { web?: { results?: Array<{ url?: string; description?: string }> } };
  const results = (data.web?.results ?? []).filter((result) => typeof result.url === "string");
  return {
    resultCount: results.length,
    snippetChars: results.reduce((sum, result) => sum + (result.description?.length ?? 0), 0),
  };
}

describe("web-access Brave live contract", () => {
  test("validates LLM Context returns richer grounding than Web Search snippets", async () => {
    // Arrange
    const query = "Pi coding agent extension API custom tools";

    // Act
    const web = await searchWithBraveWebEndpoint(query);
    const context = await searchWithBrave(query, { numResults: 5, includeContent: true });
    const contextChars = (context.inlineContent ?? []).reduce((sum, result) => sum + result.content.length, 0);

    // Assert
    expect(web.resultCount).toBeGreaterThan(0);
    expect(context.provider).toBe("brave");
    expect(context.results.length).toBeGreaterThan(0);
    expect(contextChars).toBeGreaterThan(web.snippetChars);
  }, 90_000);
});

import { describe, expect, test } from "bun:test";
import { fetchWithExaContents, searchWithExa } from "./exa";

describe("web-access Exa live contract", () => {
  test("validates Exa search and contents contracts", async () => {
    const search = await searchWithExa("Exa API documentation", { numResults: 2 });

    expect(search.provider).toBe("exa");
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results[0]?.url).toStartWith("http");

    const contents = await fetchWithExaContents("https://example.com");
    expect(contents?.provider).toBe("exa");
    expect(contents?.content.length ?? 0).toBeGreaterThan(20);
  }, 90_000);
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchWithExaContents, mapDomainFilter, searchWithExa } from "./exa";

const originalFetch = globalThis.fetch;
const originalExaKey = process.env.EXA_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalExaKey === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = originalExaKey;
  mock.clearAllMocks();
});

describe("mapDomainFilter", () => {
  test("maps include and exclude domains for Exa", () => {
    // Arrange
    const filters = ["example.com", "-spam.test", " docs.example.com "];

    // Act
    const result = mapDomainFilter(filters);

    // Assert
    expect(result).toEqual({
      includeDomains: ["example.com", "docs.example.com"],
      excludeDomains: ["spam.test"],
    });
  });

  test("omits empty filters", () => {
    // Arrange / Act / Assert
    expect(mapDomainFilter(undefined)).toEqual({});
    expect(mapDomainFilter([])).toEqual({});
  });
});

describe("searchWithExa", () => {
  test("retries once when Exa returns a rate limit response", async () => {
    // Arrange
    process.env.EXA_API_KEY = "test-key";
    let callCount = 0;
    const fetchMock = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too many requests", { status: 429, headers: { "retry-after": "0" } });
      }
      return new Response(
        JSON.stringify({ results: [{ url: "https://example.com", title: "Example", text: "Snippet" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await searchWithExa("docs", { numResults: 1 });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("exa");
    expect(result.results[0]?.url).toBe("https://example.com");
  });

  test("reports Exa rate limits with retry guidance", async () => {
    // Arrange
    process.env.EXA_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("Too many requests", { status: 429, headers: { "retry-after": "30" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act / Assert
    await expect(searchWithExa("docs", { numResults: 1 })).rejects.toThrow(
      "Exa API rate limit exceeded (429). Retry after 30 second(s). Response: Too many requests",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchWithExaContents", () => {
  test("calls Exa Contents API with top-level text parameters", async () => {
    // Arrange
    process.env.EXA_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [{ url: "https://example.com", title: "Example", text: "# Example\n\nContent" }],
            statuses: [{ id: "https://example.com", status: "success" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await fetchWithExaContents("https://example.com");

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.exa.ai/contents");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      urls: ["https://example.com"],
      text: { maxCharacters: 50_000 },
      maxAgeHours: 24,
      livecrawlTimeout: 15_000,
    });
    expect(result?.provider).toBe("exa");
    expect(result?.content).toContain("Content");
  });
});

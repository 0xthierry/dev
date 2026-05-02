import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchWithTavilyExtract, mapTavilyDomainFilter, searchWithTavily } from "./tavily";

const originalFetch = globalThis.fetch;
const originalTavilyKey = process.env.TAVILY_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalTavilyKey === undefined) delete process.env.TAVILY_API_KEY;
  else process.env.TAVILY_API_KEY = originalTavilyKey;
  mock.clearAllMocks();
});

describe("mapTavilyDomainFilter", () => {
  test("maps include and exclude domains for Tavily", () => {
    // Arrange
    const filters = ["example.com", " docs.example.com ", "-spam.test"];

    // Act
    const result = mapTavilyDomainFilter(filters);

    // Assert
    expect(result).toEqual({
      include_domains: ["example.com", "docs.example.com"],
      exclude_domains: ["spam.test"],
    });
  });
});

describe("searchWithTavily", () => {
  test("calls Tavily Search and maps raw content for retrieval", async () => {
    // Arrange
    process.env.TAVILY_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            answer: "Tavily answer",
            results: [
              {
                title: "Docs",
                url: "https://example.com/docs",
                content: "Short summary",
                raw_content: "# Docs\n\nFull markdown content",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await searchWithTavily("docs", {
      numResults: 2,
      includeContent: true,
      recencyFilter: "month",
      domainFilter: ["example.com", "-spam.test"],
    });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tavily.com/search");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer test-key" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      query: "docs",
      search_depth: "basic",
      max_results: 2,
      include_answer: "basic",
      include_raw_content: "markdown",
      time_range: "month",
      include_domains: ["example.com"],
      exclude_domains: ["spam.test"],
    });
    expect(result).toMatchObject({
      answer: "Tavily answer",
      provider: "tavily",
      results: [{ title: "Docs", url: "https://example.com/docs", snippet: "Short summary" }],
      inlineContent: [
        {
          url: "https://example.com/docs",
          title: "Docs",
          content: "# Docs\n\nFull markdown content",
          provider: "tavily",
        },
      ],
    });
  });

  test("reports Tavily rate limits", async () => {
    // Arrange
    process.env.TAVILY_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ detail: { error: "Please reduce rate of requests." } }), { status: 429 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act / Assert
    await expect(searchWithTavily("docs", { numResults: 1 })).rejects.toThrow(
      "Tavily API rate limit exceeded (429). Response: Please reduce rate of requests.",
    );
  });
});

describe("fetchWithTavilyExtract", () => {
  test("calls Tavily Extract with markdown output", async () => {
    // Arrange
    process.env.TAVILY_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            results: [{ url: "https://example.com", raw_content: "# Example\n\nReadable content" }],
            failed_results: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await fetchWithTavilyExtract("https://example.com", "find the docs");

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.tavily.com/extract");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      urls: "https://example.com",
      extract_depth: "basic",
      format: "markdown",
      timeout: 30,
      query: "find the docs",
      chunks_per_source: 5,
    });
    expect(result).toMatchObject({
      url: "https://example.com",
      title: "Example",
      content: "# Example\n\nReadable content",
      provider: "tavily",
    });
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { buildBraveQuery, mapBraveFreshness, searchWithBrave } from "./brave";

const originalFetch = globalThis.fetch;
const originalBraveKey = process.env.BRAVE_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBraveKey === undefined) delete process.env.BRAVE_API_KEY;
  else process.env.BRAVE_API_KEY = originalBraveKey;
  mock.clearAllMocks();
});

describe("mapBraveFreshness", () => {
  test("maps recency filters to Brave freshness values", () => {
    // Arrange
    const filters = ["day", "week", "month", "year"] as const;

    // Act
    const values = filters.map((filter) => mapBraveFreshness(filter));

    // Assert
    expect(values).toEqual(["pd", "pw", "pm", "py"]);
  });
});

describe("buildBraveQuery", () => {
  test("maps domain filters to Brave search operators", () => {
    // Arrange
    const filters = ["docs.example.com", "api.example.com", "-spam.test"];

    // Act
    const query = buildBraveQuery("agent docs", filters);

    // Assert
    expect(query).toBe("agent docs (site:docs.example.com OR site:api.example.com) -site:spam.test");
  });
});

describe("searchWithBrave", () => {
  test("calls Brave LLM Context and stores extracted snippets as inline content", async () => {
    // Arrange
    process.env.BRAVE_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            grounding: {
              generic: [
                {
                  url: "https://example.com/docs",
                  title: "Docs",
                  snippets: ["First relevant chunk", "Second relevant chunk"],
                },
              ],
            },
            sources: {
              "https://example.com/docs": {
                title: "Docs source",
                hostname: "example.com",
                age: ["Friday, May 1, 2026", "2026-05-01", "1 day ago"],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await searchWithBrave("docs", {
      numResults: 3,
      includeContent: true,
      recencyFilter: "week",
      domainFilter: ["example.com", "-spam.test"],
    });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.search.brave.com/res/v1/llm/context");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "X-Subscription-Token": "test-key" });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      q: "docs site:example.com -site:spam.test",
      count: 3,
      maximum_number_of_urls: 3,
      freshness: "pw",
    });
    expect(result.provider).toBe("brave");
    expect(result.results).toEqual([
      {
        title: "Docs",
        url: "https://example.com/docs",
        snippet: "First relevant chunk --- Second relevant chunk",
        publishedDate: "2026-05-01",
        source: "example.com",
      },
    ]);
    expect(result.inlineContent?.[0]).toMatchObject({
      url: "https://example.com/docs",
      content: "First relevant chunk\n\n---\n\nSecond relevant chunk",
      provider: "brave",
    });
  });

  test("retries Brave rate limits when retry guidance is short", async () => {
    // Arrange
    process.env.BRAVE_API_KEY = "test-key";
    const responses = [
      new Response(JSON.stringify({ error: { detail: "Too many requests" } }), {
        status: 429,
        headers: { "retry-after": "0" },
      }),
      new Response(JSON.stringify({ grounding: { generic: [{ url: "https://example.com", snippets: ["ok"] }] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    const fetchMock = mock(async () => responses.shift() ?? new Response("unexpected", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const result = await searchWithBrave("docs", { numResults: 1 });

    // Assert
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.results[0]?.url).toBe("https://example.com");
  });

  test("reports Brave rate limits with retry guidance when provided", async () => {
    // Arrange
    process.env.BRAVE_API_KEY = "test-key";
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: { detail: "Too many requests" } }), {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act / Assert
    await expect(searchWithBrave("docs", { numResults: 1 })).rejects.toThrow(
      "Brave Search API rate limit exceeded (429). Retry after 30 second(s). Response: Too many requests",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

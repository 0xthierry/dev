import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { clearResults } from "../storage/result-store";
import type { SearchResponse } from "../types";
import type { WebAccessRuntime } from "./runtime";
import { registerWebSearchTool } from "./web-search-tool";

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details: Record<string, unknown>;
};

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for condition");
}

function runtime(): WebAccessRuntime {
  return {
    search: mock(
      async (query: string): Promise<SearchResponse> => ({
        answer: `Answer ${query}`,
        provider: "exa",
        results: [{ title: "Source", url: "https://example.com", snippet: "Snippet" }],
      }),
    ),
    fetchAllContent: mock(async () => []),
    generateId: mock(() => "search-id"),
    now: mock(() => 123),
  };
}

afterEach(() => {
  clearResults();
  mock.clearAllMocks();
});

describe("registerWebSearchTool", () => {
  test("registers web_search and stores successful results", async () => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime();
    registerWebSearchTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("web_search", { query: "docs" })) as ToolResult;

    // Assert
    expect(fakeRuntime.search).toHaveBeenCalledWith("docs", expect.objectContaining({ signal: undefined }));
    expect(result.content[0]?.text).toContain("Answer docs");
    expect(result.details).toMatchObject({ searchId: "search-id", successfulQueries: 1, totalResults: 1 });
    expect(fake.appendedEntries).toHaveLength(1);
  });

  test("returns a structured validation error when no query is provided", async () => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime();
    registerWebSearchTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("web_search", {})) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("No search query provided");
    expect(result.details.error).toMatchObject({ code: "NO_QUERY_PROVIDED", retriable: false });
    expect(fakeRuntime.search).not.toHaveBeenCalled();
  });

  test("runs multiple queries with a concurrency limit of 10", async () => {
    // Arrange
    const fake = createFakePi();
    const releases: Array<() => void> = [];
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;
    const fakeRuntime: WebAccessRuntime = {
      ...runtime(),
      search: mock(async (query: string): Promise<SearchResponse> => {
        started.push(query);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        return {
          answer: `Answer ${query}`,
          provider: "exa",
          results: [{ title: `Source ${query}`, url: `https://example.com/${query}`, snippet: "Snippet" }],
        };
      }),
    };
    registerWebSearchTool(fake.pi, fakeRuntime);

    // Act
    const queries = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
    const pendingResult = fake.runTool("web_search", { queries }) as Promise<ToolResult>;
    await waitFor(() => started.length === 10);

    // Assert
    expect(started).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
    expect(fakeRuntime.search).toHaveBeenCalledTimes(10);

    // Act
    for (const release of releases.splice(0)) release();
    await waitFor(() => started.length === 12);
    for (const release of releases.splice(0)) release();
    const result = await pendingResult;

    // Assert
    expect(maxActive).toBe(10);
    expect(fakeRuntime.search).toHaveBeenCalledTimes(12);
    expect(result.details.queries).toEqual(queries);
    const output = result.content[0]?.text ?? "";
    expect(output.indexOf('## Query: "a"')).toBeLessThan(output.indexOf('## Query: "l"'));
  });
});

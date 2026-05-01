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
});

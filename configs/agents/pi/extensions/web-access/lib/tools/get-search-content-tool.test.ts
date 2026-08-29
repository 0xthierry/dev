import { afterEach, describe, expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { fetchFailedError, searchFailedError } from "../shared/errors";
import { clearResults, storeResult } from "../storage/result-store";
import { WebAccessToolError } from "./errors";
import { registerGetSearchContentTool, sliceContentRange } from "./get-search-content-tool";

type ToolResult = {
  content: Array<{ type: string; text?: string }>;
  details: Record<string, unknown>;
};

afterEach(() => {
  clearResults();
});

describe("sliceContentRange", () => {
  test("normalizes and caps stored content ranges", () => {
    // Arrange
    const content = "abcdefghijklmnopqrstuvwxyz";

    // Act
    const first = sliceContentRange(content, undefined, 10);
    const second = sliceContentRange(content, 10, 10);
    const capped = sliceContentRange(content, -1, 999_999);

    // Assert
    expect(first).toEqual({ offset: 0, limit: 10, endOffset: 10, text: "abcdefghij", hasMore: true });
    expect(second).toEqual({ offset: 10, limit: 10, endOffset: 20, text: "klmnopqrst", hasMore: true });
    expect(capped.limit).toBe(30_000);
    expect(capped.offset).toBe(0);
  });
});

describe("registerGetSearchContentTool", () => {
  test("throws a structured error for missing stored results", async () => {
    // Arrange
    const fake = createFakePi();
    registerGetSearchContentTool(fake.pi);

    // Act
    const error = await fake.runTool("get_search_content", { responseId: "missing" }).catch((thrown) => thrown);

    // Assert
    expect(error).toBeInstanceOf(WebAccessToolError);
    expect((error as WebAccessToolError).message).toContain("Stored result not found");
    expect((error as WebAccessToolError).webAccessError).toMatchObject({
      code: "STORED_RESULT_NOT_FOUND",
      retriable: false,
    });
  });

  test("retrieves stored search results by query index", async () => {
    // Arrange
    const fake = createFakePi();
    storeResult("search-id", {
      id: "search-id",
      type: "search",
      timestamp: 1,
      queries: [
        { query: "first", answer: "First answer", results: [], error: null },
        {
          query: "second",
          answer: "Second answer",
          results: [{ title: "Source", url: "https://example.com", snippet: "Snippet" }],
          error: null,
        },
      ],
    });
    registerGetSearchContentTool(fake.pi);

    // Act
    const result = (await fake.runTool("get_search_content", { responseId: "search-id", queryIndex: 1 })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("Second answer");
    expect(result.content[0]?.text).toContain("https://example.com");
    expect(result.details).toMatchObject({
      query: "second",
      resultCount: 1,
      offset: 0,
      returnedChars: result.details.contentLength,
      nextOffset: null,
      truncated: false,
    });
  });

  test("paginates oversized stored search summaries", async () => {
    // Arrange
    const fake = createFakePi();
    const answer = "a".repeat(30_010);
    storeResult("search-id", {
      id: "search-id",
      type: "search",
      timestamp: 1,
      queries: [{ query: "large", answer, results: [], error: null }],
    });
    registerGetSearchContentTool(fake.pi);

    // Act
    const first = (await fake.runTool("get_search_content", {
      responseId: "search-id",
      queryIndex: 0,
    })) as ToolResult;
    const second = (await fake.runTool("get_search_content", {
      responseId: "search-id",
      queryIndex: 0,
      offset: 30_000,
      limit: 20,
    })) as ToolResult;

    // Assert
    expect(first.content[0]?.text).toContain(
      'get_search_content({ responseId: "search-id", queryIndex: 0, offset: 30000 })',
    );
    expect(first.details).toMatchObject({
      contentLength: answer.length + "\n\n---\n\n**Sources:**\nNo source URLs found.".length,
      offset: 0,
      limit: 30_000,
      returnedChars: 30_000,
      nextOffset: 30_000,
      truncated: true,
    });
    expect(second.content[0]?.text).toStartWith("aaaaaaaaaa");
    expect(second.content[0]?.text).toContain("offset: 30020, limit: 20");
    expect(second.details).toMatchObject({
      offset: 30_000,
      limit: 20,
      returnedChars: 20,
      nextOffset: 30_020,
      truncated: true,
    });
  });

  test("returns stored structured failures", async () => {
    // Arrange
    const fake = createFakePi();
    const errorDetails = searchFailedError("provider failed", { query: "bad" });
    storeResult("search-id", {
      id: "search-id",
      type: "search",
      timestamp: 1,
      queries: [{ query: "bad", answer: "", results: [], error: "provider failed", errorDetails }],
    });
    registerGetSearchContentTool(fake.pi);

    // Act
    const result = (await fake.runTool("get_search_content", { responseId: "search-id" })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("Web search failed");
    expect(result.details.error).toBe(errorDetails);
  });

  test("retrieves stored fetch content by URL", async () => {
    // Arrange
    const fake = createFakePi();
    storeResult("fetch-id", {
      id: "fetch-id",
      type: "fetch",
      timestamp: 1,
      urls: [{ url: "https://example.com", title: "Example", content: "Body", error: null, provider: "http" }],
    });
    registerGetSearchContentTool(fake.pi);

    // Act
    const result = (await fake.runTool("get_search_content", {
      responseId: "fetch-id",
      url: "https://example.com",
    })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("# Example");
    expect(result.content[0]?.text).toContain("Body");
    expect(result.details).toMatchObject({ url: "https://example.com", contentLength: 4 });
  });

  test("retrieves stored fetch content by offset and limit", async () => {
    // Arrange
    const fake = createFakePi();
    storeResult("fetch-id", {
      id: "fetch-id",
      type: "fetch",
      timestamp: 1,
      urls: [
        {
          url: "https://example.com",
          title: "Example",
          content: "abcdefghijklmnopqrstuvwxyz",
          error: null,
          provider: "http",
        },
      ],
    });
    registerGetSearchContentTool(fake.pi);

    // Act
    const result = (await fake.runTool("get_search_content", {
      responseId: "fetch-id",
      urlIndex: 0,
      offset: 10,
      limit: 5,
    })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("klmno");
    expect(result.content[0]?.text).not.toContain("abcdef");
    expect(result.content[0]?.text).toContain("offset: 15, limit: 5");
    expect(result.details).toMatchObject({
      offset: 10,
      limit: 5,
      returnedChars: 5,
      nextOffset: 15,
      truncated: true,
    });
  });

  test("returns stored fetch failures", async () => {
    // Arrange
    const fake = createFakePi();
    const errorDetails = fetchFailedError("https://example.com", "blocked");
    storeResult("fetch-id", {
      id: "fetch-id",
      type: "fetch",
      timestamp: 1,
      urls: [{ url: "https://example.com", title: "", content: "", error: "blocked", errorDetails }],
    });
    registerGetSearchContentTool(fake.pi);

    // Act
    const result = (await fake.runTool("get_search_content", { responseId: "fetch-id" })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("Content extraction failed");
    expect(result.details.error).toBe(errorDetails);
  });
});

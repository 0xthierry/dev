import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { fetchFailedError } from "../shared/errors";
import { clearResults } from "../storage/result-store";
import type { ExtractedContent } from "../types";
import { MAX_INLINE_CONTENT } from "./definitions";
import { WebAccessToolError } from "./errors";
import { registerFetchContentTool } from "./fetch-content-tool";
import type { WebAccessRuntime } from "./runtime";

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: Record<string, unknown>;
};

function runtime(results: ExtractedContent[] = []): WebAccessRuntime {
  return {
    search: mock(async () => ({ answer: "", provider: "exa" as const, results: [] })),
    fetchAllContent: mock(async () => results),
    generateId: mock(() => "fetch-id"),
  };
}

afterEach(() => {
  clearResults();
  mock.clearAllMocks();
});

describe("registerFetchContentTool", () => {
  test("registers fetch_content and stores fetched content", async () => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime([
      { url: "https://example.com", title: "Example", content: "Body", error: null, provider: "http" },
    ]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", { url: "https://example.com" })) as ToolResult;

    // Assert
    expect(fakeRuntime.fetchAllContent).toHaveBeenCalledWith(["https://example.com"], undefined, expect.any(Object));
    expect(fakeRuntime.generateId).toHaveBeenCalledWith(
      "fetch",
      expect.objectContaining({ urls: ["https://example.com"] }),
    );
    expect(result.content.at(-1)?.text).toBe("Body");
    expect(result.details).toMatchObject({ responseId: "fetch-id", successful: 1 });
    expect(fake.appendedEntries).toHaveLength(1);
  });

  test("falls back to the single URL when urls is empty", async () => {
    // Arrange
    const fake = createFakePi();
    const url = "https://www.youtube.com/watch?v=rb5SlUg0CWU";
    const fakeRuntime = runtime([{ url, title: "Video", content: "Transcript", error: null, provider: "youtube" }]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", { url, urls: [] })) as ToolResult;

    // Assert
    expect(fakeRuntime.fetchAllContent).toHaveBeenCalledWith([url], undefined, expect.any(Object));
    expect(result.content.at(-1)?.text).toBe("Transcript");
    expect(result.details).toMatchObject({ urls: [url], urlCount: 1, successful: 1 });
  });

  test("keeps a nonempty urls array authoritative when url is also provided", async () => {
    // Arrange
    const fake = createFakePi();
    const url = "https://example.com/batch";
    const fakeRuntime = runtime([{ url, title: "Example", content: "Body", error: null, provider: "http" }]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", {
      url: "https://example.com/ignored",
      urls: [url],
    })) as ToolResult;

    // Assert
    expect(fakeRuntime.fetchAllContent).toHaveBeenCalledWith([url], undefined, expect.any(Object));
    expect(result.details).toMatchObject({ urls: [url], successful: 1 });
  });

  test("points to the next stored chunk when inline content is truncated", async () => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime([
      { url: "https://example.com", title: "Example", content: "x".repeat(30_001), error: null, provider: "http" },
    ]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", { url: "https://example.com" })) as ToolResult;

    // Assert
    expect(result.content.at(-1)?.text).toContain("offset: 30000");
    expect(result.content.at(-1)?.text).toContain("Use get_search_content");
    expect(result.details).toMatchObject({ truncated: true, totalChars: 30_001 });
  });

  test("caps oversized batch summaries and points to stored content", async () => {
    // Arrange
    const fake = createFakePi();
    const results: ExtractedContent[] = Array.from({ length: 20 }, (_, index) => ({
      url: `https://example.com/${index}`,
      title: `${index}-${"x".repeat(2_000)}`,
      content: "Body",
      error: null,
      provider: "http",
    }));
    const fakeRuntime = runtime(results);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", { urls: results.map((item) => item.url) })) as ToolResult;
    const summary = result.content[0]?.text ?? "";

    // Assert
    expect(summary.length).toBeLessThanOrEqual(MAX_INLINE_CONTENT);
    expect(summary).toContain("[Batch summary truncated]");
    expect(summary).toContain('get_search_content({ responseId: "fetch-id", urlIndex: 0 })');
    expect(result.details).toMatchObject({ responseId: "fetch-id", urlCount: 20, successful: 20, truncated: true });
    expect(fake.appendedEntries).toHaveLength(1);
  });

  test("leaves normal batch summaries untruncated", async () => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime([
      { url: "https://example.com/a", title: "A", content: "First", error: null, provider: "http" },
      { url: "https://example.com/b", title: "B", content: "Second", error: null, provider: "http" },
    ]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", {
      urls: ["https://example.com/a", "https://example.com/b"],
    })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("- 0: A (5 chars)");
    expect(result.content[0]?.text).toContain("- 1: B (6 chars)");
    expect(result.details.truncated).toBe(false);
  });

  test.each([
    {},
    { urls: [] },
    { url: "", urls: [] },
  ])("throws a structured validation error when no URL is provided: %j", async (params) => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime();
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const error = await fake.runTool("fetch_content", params).catch((thrown) => thrown);

    // Assert
    expect(error).toBeInstanceOf(WebAccessToolError);
    expect((error as WebAccessToolError).message).toContain("No URL provided");
    expect((error as WebAccessToolError).webAccessError).toMatchObject({ code: "NO_URL_PROVIDED", retriable: false });
    expect(fakeRuntime.fetchAllContent).not.toHaveBeenCalled();
  });

  test("throws structured extraction errors when a single URL fetch fails", async () => {
    // Arrange
    const fake = createFakePi();
    const errorDetails = fetchFailedError("https://example.com", "blocked");
    const fakeRuntime = runtime([
      { url: "https://example.com", title: "", content: "", error: "blocked", errorDetails },
    ]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const error = await fake.runTool("fetch_content", { url: "https://example.com" }).catch((thrown) => thrown);

    // Assert
    expect(error).toBeInstanceOf(WebAccessToolError);
    expect((error as WebAccessToolError).message).toContain("Content extraction failed");
    expect((error as WebAccessToolError).webAccessError).toBe(errorDetails);
  });
});

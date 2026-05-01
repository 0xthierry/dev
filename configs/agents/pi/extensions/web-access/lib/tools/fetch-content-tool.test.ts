import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { fetchFailedError } from "../shared/errors";
import { clearResults } from "../storage/result-store";
import type { ExtractedContent } from "../types";
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
    now: mock(() => 123),
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
    expect(result.content.at(-1)?.text).toBe("Body");
    expect(result.details).toMatchObject({ responseId: "fetch-id", successful: 1 });
    expect(fake.appendedEntries).toHaveLength(1);
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

  test("returns a structured validation error when no URL is provided", async () => {
    // Arrange
    const fake = createFakePi();
    const fakeRuntime = runtime();
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", {})) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("No URL provided");
    expect(result.details.error).toMatchObject({ code: "NO_URL_PROVIDED", retriable: false });
    expect(fakeRuntime.fetchAllContent).not.toHaveBeenCalled();
  });

  test("returns structured extraction errors", async () => {
    // Arrange
    const fake = createFakePi();
    const errorDetails = fetchFailedError("https://example.com", "blocked");
    const fakeRuntime = runtime([
      { url: "https://example.com", title: "", content: "", error: "blocked", errorDetails },
    ]);
    registerFetchContentTool(fake.pi, fakeRuntime);

    // Act
    const result = (await fake.runTool("fetch_content", { url: "https://example.com" })) as ToolResult;

    // Assert
    expect(result.content[0]?.text).toContain("Content extraction failed");
    expect(result.details.error).toBe(errorDetails);
    expect(result.details).toMatchObject({ responseId: "fetch-id", successful: 0 });
  });
});

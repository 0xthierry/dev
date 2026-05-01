import { describe, expect, test } from "bun:test";
import type { ExtractedContent, QueryResultData } from "../types";
import { formatSearchSummary, stripImages, uniqueUrls } from "./render";

describe("formatSearchSummary", () => {
  test("renders answers and numbered sources", () => {
    // Arrange
    const results = [{ title: "Example", url: "https://example.com", snippet: "Snippet" }];

    // Act
    const summary = formatSearchSummary(results, "Answer");

    // Assert
    expect(summary).toContain("Answer");
    expect(summary).toContain("1. Example");
    expect(summary).toContain("https://example.com");
    expect(summary).toContain("Snippet");
  });
});

describe("uniqueUrls", () => {
  test("deduplicates URLs across query results", () => {
    // Arrange
    const queries: QueryResultData[] = [
      {
        query: "one",
        answer: "",
        error: null,
        results: [
          { title: "A", url: "https://example.com/a", snippet: "" },
          { title: "A again", url: "https://example.com/a", snippet: "" },
        ],
      },
      {
        query: "two",
        answer: "",
        error: null,
        results: [{ title: "B", url: "https://example.com/b", snippet: "" }],
      },
    ];

    // Act
    const urls = uniqueUrls(queries);

    // Assert
    expect(urls).toEqual(["https://example.com/a", "https://example.com/b"]);
  });
});

describe("stripImages", () => {
  test("removes thumbnails and frames before storage", () => {
    // Arrange
    const results: ExtractedContent[] = [
      {
        url: "https://example.com",
        title: "Example",
        content: "Content",
        error: null,
        provider: "http",
        thumbnail: { data: "base64", mimeType: "image/jpeg" },
        frames: [{ data: "frame", mimeType: "image/jpeg", timestamp: "0:01" }],
      },
    ];

    // Act
    const stripped = stripImages(results);

    // Assert
    expect(stripped).toEqual([
      { url: "https://example.com", title: "Example", content: "Content", error: null, provider: "http" },
    ]);
  });
});

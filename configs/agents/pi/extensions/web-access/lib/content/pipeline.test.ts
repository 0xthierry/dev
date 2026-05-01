import { describe, expect, test } from "bun:test";
import { fetchFailedError, unsupportedContentTypeError } from "../shared/errors";
import { type ContentExtractor, extractContent } from "./pipeline";

describe("content pipeline", () => {
  test("continues from non-terminal extractor failures to later successes", async () => {
    // Arrange
    const failureThenSuccess: ContentExtractor[] = [
      {
        name: "first",
        supports: () => true,
        extract: async (target) => ({
          status: "failure" as const,
          result: {
            url: target.url,
            title: "",
            content: "",
            error: "HTTP 500",
            errorDetails: fetchFailedError(target.url, "HTTP 500"),
          },
        }),
      },
      {
        name: "second",
        supports: () => true,
        extract: async (target) => ({
          status: "success" as const,
          result: { url: target.url, title: "OK", content: "Readable content", error: null, provider: "http" as const },
        }),
      },
    ];

    // Act
    const result = await extractContent("https://example.com/article", undefined, {}, failureThenSuccess);

    // Assert
    expect(result.error).toBeNull();
    expect(result.content).toBe("Readable content");
  });

  test("returns terminal extractor failures without trying later extractors", async () => {
    // Arrange
    let secondCalled = false;
    const terminalThenSuccess: ContentExtractor[] = [
      {
        name: "terminal",
        supports: () => true,
        extract: async (target) => ({
          status: "terminal" as const,
          result: {
            url: target.url,
            title: "",
            content: "",
            error: "Unsupported content type: image/png",
            errorDetails: unsupportedContentTypeError(target.url, "Unsupported content type: image/png"),
          },
        }),
      },
      {
        name: "second",
        supports: () => true,
        extract: async (target) => {
          secondCalled = true;
          return {
            status: "success" as const,
            result: {
              url: target.url,
              title: "OK",
              content: "Readable content",
              error: null,
              provider: "http" as const,
            },
          };
        },
      },
    ];

    // Act
    const result = await extractContent("https://example.com/image", undefined, {}, terminalThenSuccess);

    // Assert
    expect(result.error).toBe("Unsupported content type: image/png");
    expect(secondCalled).toBe(false);
  });

  test("reports the first fallback failure when no extractor succeeds", async () => {
    // Arrange
    const failures: ContentExtractor[] = [
      {
        name: "first",
        supports: () => true,
        extract: async (target) => ({
          status: "failure" as const,
          result: {
            url: target.url,
            title: "",
            content: "",
            error: "HTTP 500",
            errorDetails: fetchFailedError(target.url, "HTTP 500"),
          },
        }),
      },
      { name: "miss", supports: () => true, extract: async () => ({ status: "miss" as const }) },
    ];

    // Act
    const result = await extractContent("https://example.com/article", undefined, {}, failures);

    // Assert
    expect(result.error).toContain("HTTP 500");
    expect(result.error).toContain("Fallbacks failed");
    expect(result.errorDetails?.code).toBe("FETCH_FAILED");
  });
});

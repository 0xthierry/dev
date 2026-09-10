import { describe, expect, mock, test } from "bun:test";
import { fetchFailedError, unsupportedContentTypeError } from "../shared/errors";
import type { ExtractedContent } from "../types";
import {
  type ContentExtractor,
  createDefaultContentExtractors,
  createYouTubeTranscriptExtractor,
  extractContent,
} from "./pipeline";

describe("YouTube transcript errors", () => {
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

  test.each([
    ["transport error", new Error("Header overflow"), "FETCH_FAILED", "Header overflow"],
    ["string error", "Provider connection failed", "FETCH_FAILED", "Provider connection failed"],
    ["abort", new Error("Aborted"), "ABORTED", "Aborted"],
    ["missing cookies", null, "AUTH_REQUIRED", "Sign into gemini.google.com"],
  ])("keeps %s terminal", async (_name, failure, code, message) => {
    // Arrange
    const provider = mock(async () => {
      if (failure !== null) throw failure;
      return null;
    });
    const fallback = mock(async () => ({ status: "miss" as const }));
    const extractor = createYouTubeTranscriptExtractor(provider);

    // Act
    const result = await extractContent(url, undefined, {}, [
      { ...extractor, supports: () => true },
      { name: "fallback", supports: () => true, extract: fallback },
    ]);

    // Assert
    expect(result.errorDetails?.code).toBe(code);
    expect(result.error).toContain(message);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  test.each([
    "Header overflow; Cookie: SID=private-cookie",
    "Header overflow; Authorization: Bearer private-token",
    "Header overflow; token=private-token",
    "Header overflow at https://user:password@example.com/?key=private-key",
    "Header overflow\nSet-Cookie: SID=private-cookie",
  ])("does not expose credentials from %s", async (message) => {
    // Arrange
    const provider = mock(async () => {
      throw new Error(message);
    });
    const extractor = createYouTubeTranscriptExtractor(provider);

    // Act
    const result = await extractContent(url, undefined, {}, [{ ...extractor, supports: () => true }]);

    // Assert
    expect(result.errorDetails?.code).toBe("FETCH_FAILED");
    expect(result.error).toContain("Header overflow");
    expect(result.errorDetails?.whatHappened).toBe(result.error ?? undefined);
    expect(JSON.stringify(result)).not.toMatch(/private-|user:password/);
  });

  test("exposes the safe transport cause code in the rendered failure details", async () => {
    // Arrange
    const failure = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Headers Overflow Error"), { code: "UND_ERR_HEADERS_OVERFLOW" }),
    });
    const provider = mock(async () => {
      throw failure;
    });
    const extractor = createYouTubeTranscriptExtractor(provider);

    // Act
    const result = await extractContent(url, undefined, {}, [{ ...extractor, supports: () => true }]);

    // Assert
    expect(result.errorDetails?.code).toBe("FETCH_FAILED");
    expect(result.errorDetails?.whatHappened).toBe(
      "Could not extract YouTube video content: fetch failed (UND_ERR_HEADERS_OVERFLOW)",
    );
  });

  test.each([
    "Cookie: SID=private-cookie",
    "token=private-token",
    "A".repeat(65),
    "lowercase_code",
  ])("does not expose an invalid transport cause code %s", async (code) => {
    // Arrange
    const provider = mock(async () => {
      throw new TypeError("fetch failed", { cause: { code } });
    });
    const extractor = createYouTubeTranscriptExtractor(provider);

    // Act
    const result = await extractContent(url, undefined, {}, [{ ...extractor, supports: () => true }]);

    // Assert
    expect(result.errorDetails?.whatHappened).toBe("Could not extract YouTube video content: fetch failed");
    expect(JSON.stringify(result)).not.toContain(code);
  });

  test("preserves transcript results and provider arguments", async () => {
    // Arrange
    const transcript: ExtractedContent = {
      url,
      title: "Video",
      content: "00:00 Complete transcript",
      error: null,
      provider: "youtube",
    };
    const provider = mock(async () => transcript);
    const extractor = createYouTubeTranscriptExtractor(provider);
    const signal = new AbortController().signal;
    const options = { prompt: "Full transcript with timestamps", model: "gemini-3-flash-preview" };

    // Act
    const result = await extractContent(url, signal, options, [{ ...extractor, supports: () => true }]);

    // Assert
    expect(result).toBe(transcript);
    expect(provider).toHaveBeenCalledWith(url, signal, options.prompt, options.model);
  });
});

describe("content pipeline", () => {
  test("runs authenticated HTTP before public and external content providers", () => {
    // Arrange / Act
    const names = createDefaultContentExtractors().map((extractor) => extractor.name);

    // Assert
    expect(names).toEqual([
      "github",
      "youtube-transcript",
      "authenticated-http",
      "exa-contents",
      "tavily-extract",
      "http",
      "jina-reader",
      "gemini-web",
      "codex",
    ]);
  });

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

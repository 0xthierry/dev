import { describe, expect, test } from "bun:test";
import { extractHeadingTitle, extractMarkdownUrls, formatSeconds, trimText } from "./text";

describe("formatSeconds", () => {
  test("formats seconds as m:ss or h:mm:ss", () => {
    // Arrange / Act / Assert
    expect(formatSeconds(0)).toBe("0:00");
    expect(formatSeconds(65)).toBe("1:05");
    expect(formatSeconds(3661)).toBe("1:01:01");
  });

  test("clamps negative input to zero", () => {
    // Arrange / Act / Assert
    expect(formatSeconds(-5)).toBe("0:00");
  });
});

describe("trimText", () => {
  test("returns original text when it fits", () => {
    // Arrange / Act / Assert
    expect(trimText("hello", 10)).toEqual({ text: "hello", truncated: false });
  });

  test("truncates and annotates long text", () => {
    // Arrange
    const text = "abcdef";

    // Act
    const result = trimText(text, 3);

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text).toBe("abc\n\n[Content truncated at 3 characters]");
  });
});

describe("extractMarkdownUrls", () => {
  test("deduplicates URLs and strips trailing punctuation", () => {
    // Arrange / Act / Assert
    expect(extractMarkdownUrls("See https://example.com/a, and https://example.com/a. Then https://b.test/x)")).toEqual(
      ["https://example.com/a", "https://b.test/x"],
    );
  });
});

describe("extractHeadingTitle", () => {
  test("extracts markdown h1/h2 titles and removes emphasis markers", () => {
    // Arrange / Act / Assert
    expect(extractHeadingTitle("Intro\n\n# **Video Title**\nBody")).toBe("Video Title");
    expect(extractHeadingTitle("## Plain Title\nBody")).toBe("Plain Title");
  });

  test("returns null when no heading exists", () => {
    // Arrange / Act / Assert
    expect(extractHeadingTitle("No heading here")).toBeNull();
  });
});

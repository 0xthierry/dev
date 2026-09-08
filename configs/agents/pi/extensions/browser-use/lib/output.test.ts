import { describe, expect, test } from "bun:test";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import { formatBrowserUseContent } from "./output";
import type { BrowserUseContentBlock } from "./result";

function textOf(content: BrowserUseContentBlock[]): string {
  return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

const firstImage: BrowserUseContentBlock = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };
const secondImage: BrowserUseContentBlock = { type: "image", data: "d29ybGQ=", mimeType: "image/jpeg" };

function expectBounded(content: BrowserUseContentBlock[]): void {
  const text = textOf(content);
  expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
  expect(truncateHead(text).truncated).toBe(false);
  expect(text).toContain("[Browser Use text truncated");
}

describe("formatBrowserUseContent", () => {
  test("preserves small mixed output, empty text, image data, and ordering", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = [
      firstImage,
      { type: "text", text: "Screenshot" },
      { type: "text", text: "" },
      secondImage,
      { type: "text", text: "Done" },
    ];
    const original = structuredClone(content);

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expect(result).toEqual(original);
    expect(content).toEqual(original);
  });

  test.each([{ content: [] }, { content: [firstImage, secondImage] }])("preserves empty and image-only output (%#)", ({
    content,
  }) => {
    // Arrange
    const original = structuredClone([...content]);

    // Act
    const result = formatBrowserUseContent([...content]);

    // Assert
    expect(result).toEqual(original);
  });

  test("does not truncate text exactly at the byte limit", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = [{ type: "text", text: "x".repeat(DEFAULT_MAX_BYTES) }];

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expect(result).toEqual(content);
  });

  test("does not truncate text blocks exactly at the combined line limit", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = Array.from({ length: DEFAULT_MAX_LINES }, () => ({
      type: "text",
      text: "line",
    }));

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expect(result).toEqual(content);
  });

  test("shares the line limit across text blocks and keeps images after truncated text", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = [
      { type: "text", text: Array(1200).fill("first").join("\n") },
      firstImage,
      { type: "text", text: Array(1200).fill("second").join("\n") },
      secondImage,
      { type: "text", text: "omitted-tail" },
    ];
    const original = structuredClone(content);

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expectBounded(result);
    expect(result[0]).toEqual(content[0]);
    expect(result[1]).toEqual(firstImage);
    expect(result[2]).toEqual({ type: "text", text: Array(799).fill("second").join("\n") });
    expect(result[3]).toEqual(secondImage);
    expect(textOf(result)).not.toContain("omitted-tail");
    expect(content).toEqual(original);
  });

  test("shares a UTF-8 byte budget across blocks, including the truncation notice", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = [
      { type: "text", text: Array(100).fill("😀".repeat(100)).join("\n") },
      firstImage,
      { type: "text", text: Array(100).fill("é".repeat(100)).join("\n") },
      secondImage,
    ];

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expectBounded(result);
    expect(textOf(result)).toStartWith(textOf([content[0]]));
    expect(textOf(result)).not.toContain("\uFFFD");
    expect(result.filter((block) => block.type === "image")).toEqual([firstImage, secondImage]);
  });

  test("counts separators between many small blocks in the global byte budget", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = Array.from({ length: 1000 }, () => ({
      type: "text",
      text: "x".repeat(51),
    }));

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expectBounded(result);
    expect(result.length).toBeLessThan(content.length);
  });

  test("retains all images when the first text line alone exceeds the limit", () => {
    // Arrange
    const content: BrowserUseContentBlock[] = [
      firstImage,
      { type: "text", text: "x".repeat(DEFAULT_MAX_BYTES + 1) },
      secondImage,
      { type: "text", text: "later text" },
    ];

    // Act
    const result = formatBrowserUseContent(content);

    // Assert
    expectBounded(result);
    expect(result.slice(0, 2)).toEqual([firstImage, secondImage]);
    expect(result).toHaveLength(3);
    expect(textOf(result)).not.toContain("later text");
  });
});

import { afterEach, describe, expect, mock, test } from "bun:test";
import { extractWithJinaReader } from "./jina";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("extractWithJinaReader", () => {
  test("extracts markdown content after the reader marker", async () => {
    // Arrange
    const markdown = `# Reader Title\n\n${"Readable content. ".repeat(10)}`;
    globalThis.fetch = mock(async () => new Response(`Metadata\nMarkdown Content:\n${markdown}`)) as never;

    // Act
    const result = await extractWithJinaReader("https://example.com/article");

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith("https://r.jina.ai/https://example.com/article", expect.any(Object));
    expect(result).toMatchObject({
      url: "https://example.com/article",
      title: "Reader Title",
      content: markdown.trim(),
      error: null,
      provider: "jina",
    });
  });

  test("returns null for loading placeholder content", async () => {
    // Arrange
    globalThis.fetch = mock(async () => new Response("Loading...")) as never;

    // Act
    const result = await extractWithJinaReader("https://example.com/article");

    // Assert
    expect(result).toBeNull();
  });
});

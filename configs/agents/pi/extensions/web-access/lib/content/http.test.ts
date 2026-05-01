import { afterEach, describe, expect, mock, test } from "bun:test";
import { extractViaHttp } from "./http";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("extractViaHttp", () => {
  test("returns a typed failure for HTTP errors", async () => {
    // Arrange
    globalThis.fetch = mock(async () => new Response("nope", { status: 500, statusText: "Server Error" })) as never;

    // Act
    const result = await extractViaHttp("https://example.com/fail");

    // Assert
    expect(result.error).toBe("HTTP 500: Server Error");
    expect(result.errorDetails?.code).toBe("FETCH_FAILED");
  });

  test("returns a typed terminal failure for unsupported media content", async () => {
    // Arrange
    globalThis.fetch = mock(async () => new Response("image", { headers: { "content-type": "image/png" } })) as never;

    // Act
    const result = await extractViaHttp("https://example.com/image.png");

    // Assert
    expect(result.error).toBe("Unsupported content type: image/png");
    expect(result.errorDetails?.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  test("returns plain text content without readability conversion", async () => {
    // Arrange
    globalThis.fetch = mock(
      async () => new Response("# Plain Text\n\nBody", { headers: { "content-type": "text/plain" } }),
    ) as never;

    // Act
    const result = await extractViaHttp("https://example.com/readme.txt");

    // Assert
    expect(result).toMatchObject({
      url: "https://example.com/readme.txt",
      title: "Plain Text",
      content: "# Plain Text\n\nBody",
      error: null,
      provider: "http",
    });
  });
});

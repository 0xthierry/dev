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

  test("sends scoped extra headers to the initial allowed URL", async () => {
    // Arrange
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("# Private\n\nBody", { headers: { "content-type": "text/plain" } }),
    );
    globalThis.fetch = fetchMock as never;

    // Act
    const result = await extractViaHttp("https://medium.com/p/private", undefined, {
      headers: { Cookie: "sid=secret" },
      isHeaderAllowedForUrl: (url) => url.hostname === "medium.com",
    });

    // Assert
    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Cookie).toBe("sid=secret");
  });

  test("drops scoped extra headers when following redirects to disallowed hosts", async () => {
    // Arrange
    const responses = [
      new Response(null, { status: 302, headers: { location: "https://example.com/final" } }),
      new Response("# Public\n\nBody", { headers: { "content-type": "text/plain" } }),
    ];
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        responses.shift() ?? new Response("unexpected", { status: 500 }),
    );
    globalThis.fetch = fetchMock as never;

    // Act
    const result = await extractViaHttp("https://medium.com/p/private", undefined, {
      headers: { Cookie: "sid=secret" },
      isHeaderAllowedForUrl: (url) => url.hostname === "medium.com",
    });

    // Assert
    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Cookie).toBe("sid=secret");
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).Cookie).toBeUndefined();
  });
});

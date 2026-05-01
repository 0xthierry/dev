import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AuthenticatedHeaderProvider } from "./authenticated-http";
import { extractViaAuthenticatedHttp } from "./authenticated-http";
import { classifyFetchTarget, type FetchTarget } from "./target";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

function targetFor(url: string): FetchTarget {
  const classified = classifyFetchTarget(url);
  if (!classified.ok) throw new Error("Expected valid fetch target");
  return classified.target;
}

describe("extractViaAuthenticatedHttp", () => {
  test("returns null when no header provider supports the target", async () => {
    // Arrange
    const target = targetFor("https://example.com/article");
    const provider: AuthenticatedHeaderProvider = {
      name: "test-auth",
      supports: mock(() => false),
      getHeaders: mock(async () => ({ Cookie: "sid=secret" })),
      isHeaderAllowedForUrl: mock(() => true),
    };

    // Act
    const result = await extractViaAuthenticatedHttp(target, undefined, [provider]);

    // Assert
    expect(result).toBeNull();
    expect(provider.supports).toHaveBeenCalledWith(target);
    expect(provider.getHeaders).not.toHaveBeenCalled();
  });

  test("fetches with headers from the first supported provider", async () => {
    // Arrange
    const target = targetFor("https://medium.com/p/private");
    const provider: AuthenticatedHeaderProvider = {
      name: "test-auth",
      supports: mock(() => true),
      getHeaders: mock(async () => ({ Cookie: "sid=secret" })),
      isHeaderAllowedForUrl: mock((url) => url.hostname === "medium.com"),
    };
    const fetchMock = mock(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response("# Private\n\nBody", { headers: { "content-type": "text/plain" } }),
    );
    globalThis.fetch = fetchMock as never;

    // Act
    const result = await extractViaAuthenticatedHttp(target, undefined, [provider]);

    // Assert
    expect(result?.error).toBeNull();
    expect(provider.getHeaders).toHaveBeenCalledWith(target, undefined);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Cookie).toBe("sid=secret");
  });
});

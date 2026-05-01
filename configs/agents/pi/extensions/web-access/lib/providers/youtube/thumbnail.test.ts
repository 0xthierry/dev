import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchYouTubeThumbnail } from "./thumbnail";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

describe("fetchYouTubeThumbnail", () => {
  test("returns base64 JPEG thumbnail data", async () => {
    // Arrange
    const bytes = new Uint8Array([1, 2, 3, 4]);
    globalThis.fetch = mock(async () => new Response(bytes, { status: 200 })) as never;

    // Act
    const result = await fetchYouTubeThumbnail("dQw4w9WgXcQ");

    // Assert
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      expect.any(Object),
    );
    expect(result).toEqual({ data: Buffer.from(bytes).toString("base64"), mimeType: "image/jpeg" });
  });

  test("returns null when the thumbnail request fails", async () => {
    // Arrange
    globalThis.fetch = mock(async () => new Response("missing", { status: 404 })) as never;

    // Act
    const result = await fetchYouTubeThumbnail("missing-video");

    // Assert
    expect(result).toBeNull();
  });
});

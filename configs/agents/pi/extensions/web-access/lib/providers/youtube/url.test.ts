import { describe, expect, test } from "bun:test";
import { isYouTubeUrl } from "./url";

describe("isYouTubeUrl", () => {
  test("recognizes common YouTube video URL forms", () => {
    // Arrange
    const urls = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=10",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    ];

    // Act
    const results = urls.map((url) => isYouTubeUrl(url));

    // Assert
    expect(results).toEqual([
      { isYouTube: true, videoId: "dQw4w9WgXcQ" },
      { isYouTube: true, videoId: "dQw4w9WgXcQ" },
      { isYouTube: true, videoId: "dQw4w9WgXcQ" },
    ]);
  });

  test("ignores playlists and non-YouTube URLs", () => {
    // Arrange
    const urls = ["https://www.youtube.com/playlist?list=abc", "https://example.com/watch?v=dQw4w9WgXcQ"];

    // Act
    const results = urls.map((url) => isYouTubeUrl(url));

    // Assert
    expect(results).toEqual([
      { isYouTube: false, videoId: null },
      { isYouTube: false, videoId: null },
    ]);
  });
});

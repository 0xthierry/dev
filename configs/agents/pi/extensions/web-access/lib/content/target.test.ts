import { describe, expect, test } from "bun:test";
import { classifyFetchTarget } from "./target";

describe("classifyFetchTarget", () => {
  test("turns unsupported inputs into typed content errors", () => {
    // Arrange
    const invalid = "not a url";
    const pdfUrl = "https://example.com/report.pdf";
    const localVideoUrl = "file:///tmp/demo.mp4";

    // Act
    const invalidUrl = classifyFetchTarget(invalid);
    const pdf = classifyFetchTarget(pdfUrl);
    const localVideo = classifyFetchTarget(localVideoUrl);

    // Assert
    expect(invalidUrl).toMatchObject({
      ok: false,
      result: { error: "Invalid URL", errorDetails: { code: "INVALID_URL" } },
    });
    expect(pdf).toMatchObject({
      ok: false,
      result: { errorDetails: { code: "PDF_UNSUPPORTED" } },
    });
    expect(localVideo).toMatchObject({
      ok: false,
      result: { errorDetails: { code: "LOCAL_VIDEO_UNSUPPORTED" } },
    });
  });

  test("normalizes regular and YouTube frame requests into target shapes", () => {
    // Arrange
    const pageUrl = "https://example.com/page";
    const youtubeUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const nonYoutubeUrl = "https://example.com/video";

    // Act
    const page = classifyFetchTarget(pageUrl);
    const youtubeFrames = classifyFetchTarget(youtubeUrl, { timestamp: "1:23" });
    const nonYoutubeFrames = classifyFetchTarget(nonYoutubeUrl, { timestamp: "1:23" });

    // Assert
    expect(page).toMatchObject({
      ok: true,
      target: { requestKind: "content", youtube: { isYouTube: false, videoId: null } },
    });
    expect(youtubeFrames).toMatchObject({
      ok: true,
      target: { requestKind: "video-frames", youtube: { isYouTube: true, videoId: "dQw4w9WgXcQ" } },
    });
    expect(nonYoutubeFrames).toMatchObject({
      ok: false,
      result: { errorDetails: { code: "TIMESTAMP_REQUIRES_YOUTUBE" } },
    });
  });
});

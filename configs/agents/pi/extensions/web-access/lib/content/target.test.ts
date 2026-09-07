import { describe, expect, test } from "bun:test";
import { classifyFetchTarget } from "./target";

describe("classifyFetchTarget", () => {
  test.each([
    "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Hibernate.html",
    "https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md",
    "https://www.youtube.com/watch?v=rb5SlUg0CWU",
  ])("keeps zero frames and an empty timestamp on the content path: %s", (url) => {
    // Arrange
    const options = { frames: 0, timestamp: "" };

    // Act
    const result = classifyFetchTarget(url, options);

    // Assert
    expect(result).toMatchObject({ ok: true, target: { requestKind: "content" } });
  });

  test("rejects an explicit frame count for ordinary pages", () => {
    // Arrange
    const url = "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/Hibernate.html";

    // Act
    const result = classifyFetchTarget(url, { frames: 1, timestamp: "" });

    // Assert
    expect(result).toMatchObject({ ok: false, result: { errorDetails: { code: "TIMESTAMP_REQUIRES_YOUTUBE" } } });
  });

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

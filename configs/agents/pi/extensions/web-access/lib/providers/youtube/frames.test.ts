import { describe, expect, test } from "bun:test";
import { mapFfmpegError, mapYtDlpError } from "./frames";

describe("mapYtDlpError", () => {
  test("reports missing yt-dlp clearly", () => {
    // Arrange
    const error = { code: "ENOENT", message: "spawn yt-dlp ENOENT" };

    // Act
    const result = mapYtDlpError(error);

    // Assert
    expect(result).toBe("yt-dlp is not installed. Install yt-dlp to extract YouTube frames.");
  });

  test("classifies common availability failures", () => {
    // Arrange / Act / Assert
    expect(mapYtDlpError({ stderr: "This video is private" })).toBe("Video is private or unavailable");
    expect(mapYtDlpError({ stderr: "Sign in to confirm your age" })).toBe(
      "Video is age-restricted and requires authentication",
    );
    expect(mapYtDlpError({ stderr: "Video not available" })).toBe(
      "Video is unavailable in your region or has been removed",
    );
    expect(mapYtDlpError({ stderr: "This is a live stream" })).toBe("Cannot extract frames from a live stream");
  });
});

describe("mapFfmpegError", () => {
  test("reports missing ffmpeg clearly", () => {
    // Arrange
    const error = { code: "ENOENT", message: "spawn ffmpeg ENOENT" };

    // Act
    const result = mapFfmpegError(error);

    // Assert
    expect(result).toBe("ffmpeg is not installed. Install ffmpeg to extract video frames.");
  });

  test("reports timeout errors", () => {
    // Arrange
    const error = { message: "Command timed out" };

    // Act
    const result = mapFfmpegError(error);

    // Assert
    expect(result).toBe("ffmpeg timed out extracting video frame");
  });
});

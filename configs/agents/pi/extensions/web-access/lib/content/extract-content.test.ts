import { describe, expect, test } from "bun:test";
import { extractContent } from "./pipeline";

describe("extractContent no-network guards", () => {
  test("rejects invalid URLs before calling providers", async () => {
    // Arrange
    const url = "not a url";

    // Act
    const result = await extractContent(url);

    // Assert
    expect(result.error).toBe("Invalid URL");
  });

  test("reports unsupported PDFs before fallback extraction", async () => {
    // Arrange
    const url = "https://example.com/report.pdf";

    // Act
    const result = await extractContent(url);

    // Assert
    expect(result.error).toBe("PDF unsupported by this extension.");
  });

  test("reports unsupported local video files explicitly", async () => {
    // Arrange
    const url = "file:///tmp/demo.mp4";

    // Act
    const result = await extractContent(url);

    // Assert
    expect(result.error).toBe("Local video unsupported by this extension.");
  });

  test("limits timestamp and frame extraction to YouTube URLs", async () => {
    // Arrange
    const url = "https://example.com/video";

    // Act
    const result = await extractContent(url, undefined, { timestamp: "1:23" });

    // Assert
    expect(result.error).toBe("Timestamp/frame extraction only works with YouTube URLs in this extension.");
  });
});

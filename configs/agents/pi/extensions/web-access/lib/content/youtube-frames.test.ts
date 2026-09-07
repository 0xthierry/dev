import { describe, expect, test } from "bun:test";
import { planYouTubeFrameRequest } from "./youtube-frames";

describe("planYouTubeFrameRequest", () => {
  test("samples the whole video when only a frame count is provided", () => {
    // Arrange
    const options = { frames: 3 };

    // Act
    const result = planYouTubeFrameRequest(options, 20);

    // Assert
    expect(result).toEqual({
      ok: true,
      plan: { label: "0:00-0:20", title: "Frames", timestamps: [0, 10, 20] },
    });
  });

  test("plans timestamp ranges and single timestamp frame sequences uniformly", () => {
    // Arrange / Act
    const range = planYouTubeFrameRequest({ timestamp: "1:00-1:20", frames: 3 }, 100);
    const single = planYouTubeFrameRequest({ timestamp: "1:00", frames: 3 }, 100);

    // Assert
    expect(range).toEqual({
      ok: true,
      plan: { label: "1:00-1:20", title: "Frames 1:00-1:20", timestamps: [60, 70, 80] },
    });
    expect(single).toEqual({
      ok: true,
      plan: { label: "1:00-1:10", title: "Frame at 1:00", timestamps: [60, 65, 70] },
    });
  });

  test.each(["1:00", "1:00-1:20"])("treats zero as an unspecified frame count with timestamp %s", (timestamp) => {
    // Arrange
    const expected = planYouTubeFrameRequest({ timestamp }, 100);

    // Act
    const result = planYouTubeFrameRequest({ timestamp, frames: 0 }, 100);

    // Assert
    expect(expected.ok).toBe(true);
    expect(result).toEqual(expected);
  });

  test("returns typed planning failures before frame extraction", () => {
    // Arrange / Act / Assert
    expect(planYouTubeFrameRequest({ frames: 3 }, null)).toEqual({
      ok: false,
      title: "Frames",
      message: "Cannot determine video duration. Use a timestamp range instead.",
    });
    expect(planYouTubeFrameRequest({}, 100)).toEqual({ ok: false, title: "Frames", message: "Missing timestamp" });
    expect(planYouTubeFrameRequest({ timestamp: "nope" }, 100)).toEqual({
      ok: false,
      title: "",
      message: 'Invalid timestamp format: "nope". Use "H:MM:SS", "MM:SS", "85", or "start-end".',
    });
    expect(planYouTubeFrameRequest({ timestamp: "1:40", frames: 2 }, 100)).toEqual({
      ok: false,
      title: "Frame at 1:40",
      message: "Timestamp 1:45 exceeds video duration (1:40)",
    });
  });
});

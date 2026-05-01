import { describe, expect, test } from "bun:test";
import { computeRangeTimestamps, parseTimestampSpec } from "./timestamp";

describe("timestamp parsing", () => {
  test("parses seconds, clock timestamps, and ranges", () => {
    // Arrange
    const values = ["85", "1:25", "1:02:03", "1:00-1:30"];

    // Act
    const results = values.map((value) => parseTimestampSpec(value));

    // Assert
    expect(results).toEqual([
      { type: "single", seconds: 85 },
      { type: "single", seconds: 85 },
      { type: "single", seconds: 3723 },
      { type: "range", start: 60, end: 90 },
    ]);
  });

  test("rejects invalid or backwards ranges", () => {
    // Arrange
    const values = ["nope", "1:30-1:00"];

    // Act
    const results = values.map((value) => parseTimestampSpec(value));

    // Assert
    expect(results).toEqual([null, null]);
  });
});

describe("computeRangeTimestamps", () => {
  test("samples across the full range without special-case callers", () => {
    // Arrange
    const longRange = { start: 0, end: 20, frames: 5 };
    const shortRange = { start: 0, end: 4, frames: 6 };

    // Act
    const longRangeSamples = computeRangeTimestamps(longRange.start, longRange.end, longRange.frames);
    const shortRangeSamples = computeRangeTimestamps(shortRange.start, shortRange.end, shortRange.frames);

    // Assert
    expect(longRangeSamples).toEqual([0, 5, 10, 15, 20]);
    expect(shortRangeSamples).toEqual([0]);
  });
});

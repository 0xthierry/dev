import { describe, expect, test } from "bun:test";
import { PI_THINKING_LEVELS, parsePiThinkingLevel } from "./thinking";

describe("parsePiThinkingLevel", () => {
  test("normalizes supported Pi thinking levels and maps legacy max effort to xhigh", () => {
    // Arrange
    const values = ["off", " minimal ", "LOW", "medium", "high", "xhigh", "MAX"];

    // Act
    const levels = values.map((value) => parsePiThinkingLevel(value));

    // Assert
    expect(levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "xhigh"]);
  });

  test("does not advertise max as a thinking-level option", () => {
    // Arrange
    const expected: Array<(typeof PI_THINKING_LEVELS)[number]> = ["off", "minimal", "low", "medium", "high", "xhigh"];

    // Act
    const levels = [...PI_THINKING_LEVELS];

    // Assert
    expect(levels).toEqual(expected);
  });

  test("rejects unsupported thinking levels", () => {
    // Arrange
    const values = [undefined, "", "ultra", "standard", 123];

    // Act
    const levels = values.map((value) => parsePiThinkingLevel(value));

    // Assert
    expect(levels).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

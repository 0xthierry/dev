import { describe, expect, test } from "bun:test";
import { PI_THINKING_LEVELS, parsePiThinkingLevel } from "./thinking";

describe("parsePiThinkingLevel", () => {
  test("normalizes supported levels and clamps retired max and xhigh effort to high", () => {
    // Arrange
    const values = ["off", " minimal ", "LOW", "medium", "high", "xhigh", "MAX"];

    // Act
    const levels = values.map((value) => parsePiThinkingLevel(value));

    // Assert
    expect(levels).toEqual(["off", "minimal", "low", "medium", "high", "high", "high"]);
  });

  test("does not advertise retired thinking levels", () => {
    // Arrange
    const expected: Array<(typeof PI_THINKING_LEVELS)[number]> = ["off", "minimal", "low", "medium", "high"];

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

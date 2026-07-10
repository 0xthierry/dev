import { describe, expect, test } from "bun:test";
import { parsePiThinkingLevel } from "./thinking";

describe("parsePiThinkingLevel", () => {
  test("normalizes supported Pi thinking levels", () => {
    // Arrange
    const values = ["off", " minimal ", "LOW", "medium", "high", "xhigh", "MAX"];

    // Act
    const levels = values.map((value) => parsePiThinkingLevel(value));

    // Assert
    expect(levels).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
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

import { describe, expect, test } from "bun:test";
import { hasAscendingThresholds, isTokenSpeedDisplay, isValidHexColor } from "./validation";

describe("token speed validation", () => {
  test("recognizes supported display modes", () => {
    // Arrange
    const values = ["tps", "full", "compact"];

    // Act
    const results = values.map((value) => isTokenSpeedDisplay(value));

    // Assert
    expect(results).toEqual([true, true, false]);
  });

  test("validates truecolor hex values", () => {
    // Arrange
    const values = ["#00ff88", "#ABCDEF", "00ff88", "#xyzxyz"];

    // Act
    const results = values.map((value) => isValidHexColor(value));

    // Assert
    expect(results).toEqual([true, true, false, false]);
  });

  test("requires thresholds to be strictly ascending", () => {
    // Arrange
    const ascending = { tpsSlow: 0, tpsMedium: 15, tpsFast: 30, tpsBlazing: 45 };
    const tied = { tpsSlow: 0, tpsMedium: 15, tpsFast: 15, tpsBlazing: 45 };

    // Act
    const results = [hasAscendingThresholds(ascending), hasAscendingThresholds(tied)];

    // Assert
    expect(results).toEqual([true, false]);
  });
});

import { describe, expect, test } from "bun:test";
import { tokenDeltaFromUsage } from "./accounting";

describe("tokenDeltaFromUsage", () => {
  test("uses totalTokens when present", () => {
    // Arrange
    const usage = { totalTokens: 42, input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };

    // Act
    const result = tokenDeltaFromUsage(usage);

    // Assert
    expect(result).toBe(42);
  });

  test("includes cache tokens when totalTokens is absent", () => {
    // Arrange
    const usage = { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 };

    // Act
    const result = tokenDeltaFromUsage(usage);

    // Assert
    expect(result).toBe(100);
  });
});

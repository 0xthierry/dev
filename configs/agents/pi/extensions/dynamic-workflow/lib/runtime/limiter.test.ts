import { describe, expect, test } from "bun:test";
import { createLimiter } from "./limiter";

describe("createLimiter", () => {
  test("limits concurrent work and preserves caller result order", async () => {
    // Arrange
    const limiter = createLimiter(2);
    let active = 0;
    let maxActive = 0;
    const tasks = [1, 2, 3, 4].map((value) =>
      limiter(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return value;
      }),
    );

    // Act
    const results = await Promise.all(tasks);

    // Assert
    expect(results).toEqual([1, 2, 3, 4]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});

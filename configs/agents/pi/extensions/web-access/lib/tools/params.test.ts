import { describe, expect, test } from "bun:test";
import { normalizeQueryList, normalizeRecencyFilter } from "./params";

describe("normalizeQueryList", () => {
  test("normalizes a single query string", () => {
    // Arrange
    const value = "  docs  ";

    // Act
    const result = normalizeQueryList(value);

    // Assert
    expect(result).toEqual(["docs"]);
  });

  test("normalizes query arrays and drops empty values", () => {
    // Arrange
    const value = [" one ", "", 42, " two "];

    // Act
    const result = normalizeQueryList(value);

    // Assert
    expect(result).toEqual(["one", "two"]);
  });
});

describe("normalizeRecencyFilter", () => {
  test("accepts only supported recency filters", () => {
    // Arrange / Act / Assert
    expect(normalizeRecencyFilter("day")).toBe("day");
    expect(normalizeRecencyFilter("week")).toBe("week");
    expect(normalizeRecencyFilter("invalid")).toBeUndefined();
  });
});

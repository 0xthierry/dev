import { describe, expect, test } from "bun:test";
import {
  fetchFailedError,
  formatWebAccessError,
  isAbortError,
  isWebAccessError,
  noFetchUrlError,
  unknownCause,
} from "./errors";

describe("isWebAccessError", () => {
  test("accepts structured web-access errors", () => {
    // Arrange
    const error = fetchFailedError("https://example.com", "blocked");

    // Act
    const result = isWebAccessError(error);

    // Assert
    expect(result).toBe(true);
  });

  test("rejects partial error-like objects", () => {
    // Arrange
    const error = { code: "FETCH_FAILED", message: "missing fields" };

    // Act
    const result = isWebAccessError(error);

    // Assert
    expect(result).toBe(false);
  });
});

describe("formatWebAccessError", () => {
  test("formats model-friendly error guidance", () => {
    // Arrange
    const error = noFetchUrlError({ hasUrl: false });

    // Act
    const text = formatWebAccessError(error);

    // Assert
    expect(text).toContain("Error: No URL provided.");
    expect(text).toContain("What happened:");
    expect(text).toContain("What to do next:");
  });
});

describe("unknownCause", () => {
  test("extracts messages from Error values and primitives", () => {
    // Arrange / Act / Assert
    expect(unknownCause(new Error("boom"))).toBe("boom");
    expect(unknownCause("plain")).toBe("plain");
  });
});

describe("isAbortError", () => {
  test("recognizes abort-like failures", () => {
    // Arrange / Act / Assert
    expect(isAbortError(new Error("Aborted"))).toBe(true);
    expect(isAbortError(new Error("different"))).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { noFetchUrlError } from "../shared/errors";
import { errorResult, formatToolError, WebAccessToolError } from "./errors";

describe("formatToolError", () => {
  test("uses the shared model-friendly error format", () => {
    // Arrange
    const error = noFetchUrlError({ hasUrl: false });

    // Act
    const text = formatToolError(error);

    // Assert
    expect(text).toContain("Error: No URL provided.");
    expect(text).toContain("What happened:");
    expect(text).toContain("What to do next:");
  });
});

describe("errorResult", () => {
  test("returns text content and structured error details", () => {
    // Arrange
    const error = noFetchUrlError({ hasUrl: false });

    // Act
    const result = errorResult(error, { responseId: "id" });

    // Assert
    expect((result.content[0] as { text?: string } | undefined)?.text).toContain("No URL provided");
    expect(result.details).toMatchObject({ responseId: "id", error });
  });
});

describe("WebAccessToolError", () => {
  test("carries the structured error and a model-friendly message", () => {
    // Arrange
    const error = noFetchUrlError({ hasUrl: false });

    // Act
    const thrown = new WebAccessToolError(error);

    // Assert
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain("No URL provided");
    expect(thrown.webAccessError).toBe(error);
  });
});

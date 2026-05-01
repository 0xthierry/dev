import { describe, expect, test } from "bun:test";
import { formatNotification, normalizeNotificationBody, truncateNotificationBody } from "./format-notification";

describe("normalizeNotificationBody", () => {
  test("renders markdown and collapses whitespace", () => {
    // Arrange
    const text = "**Done**\n\nAll tests passed.";

    // Act
    const result = normalizeNotificationBody(text);

    // Assert
    expect(result).toBe("Done All tests passed.");
  });
});

describe("truncateNotificationBody", () => {
  test("truncates long notification bodies with an ellipsis", () => {
    // Arrange
    const body = "abcdefghijklmnopqrstuvwxyz";

    // Act
    const result = truncateNotificationBody(body, 10);

    // Assert
    expect(result).toBe("abcdefghi…");
  });
});

describe("formatNotification", () => {
  test("uses ready title when there is no body", () => {
    // Arrange
    const text = null;

    // Act
    const result = formatNotification(text);

    // Assert
    expect(result).toEqual({ title: "Ready for input", body: "" });
  });

  test("uses pi title with assistant body", () => {
    // Arrange
    const text = "Work complete.";

    // Act
    const result = formatNotification(text);

    // Assert
    expect(result).toEqual({ title: "π", body: "Work complete." });
  });
});

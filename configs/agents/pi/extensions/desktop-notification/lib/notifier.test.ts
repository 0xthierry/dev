import { describe, expect, test } from "bun:test";
import { createOsc777Notification, sanitizeOsc777Field } from "./notifier";

describe("sanitizeOsc777Field", () => {
  test("removes OSC separators and control characters", () => {
    // Arrange
    const value = "hello;\x07\x1b world";

    // Act
    const result = sanitizeOsc777Field(value);

    // Assert
    expect(result).toBe("hello world");
  });
});

describe("createOsc777Notification", () => {
  test("creates an OSC 777 notification escape sequence", () => {
    // Arrange
    const notification = { title: "π", body: "Ready" };

    // Act
    const result = createOsc777Notification(notification);

    // Assert
    expect(result).toBe("\x1b]777;notify;π;Ready\x07");
  });
});

import { describe, expect, test } from "bun:test";
import { isTimeoutError, readExecError, trimErrorText } from "./process";

describe("readExecError", () => {
  test("normalizes child-process errors", () => {
    // Arrange
    const error = { code: "ENOENT", stderr: Buffer.from("missing"), message: "spawn failed" };

    // Act
    const result = readExecError(error);

    // Assert
    expect(result).toEqual({ code: "ENOENT", stderr: "missing", message: "spawn failed" });
  });

  test("normalizes primitive thrown values", () => {
    // Arrange
    const error = "boom";

    // Act
    const result = readExecError(error);

    // Assert
    expect(result).toEqual({ stderr: "", message: "boom" });
  });
});

describe("trimErrorText", () => {
  test("collapses whitespace and limits long output", () => {
    // Arrange
    const text = ` ${"x".repeat(400)}\n\nmore `;

    // Act
    const result = trimErrorText(text);

    // Assert
    expect(result).toHaveLength(300);
    expect(result).not.toContain("\n");
  });
});

describe("isTimeoutError", () => {
  test("recognizes timeout messages in stderr or message", () => {
    // Arrange / Act / Assert
    expect(isTimeoutError({ message: "Command timed out" })).toBe(true);
    expect(isTimeoutError({ stderr: "killed by SIGTERM" })).toBe(true);
    expect(isTimeoutError({ message: "different failure" })).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { createCommentRuntime } from "./runtime";

describe("createCommentRuntime", () => {
  test("creates a runtime with an editor function", () => {
    // Arrange

    // Act
    const runtime = createCommentRuntime();

    // Assert
    expect(runtime.editText).toBeFunction();
  });
});

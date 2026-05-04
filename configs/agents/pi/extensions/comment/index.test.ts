import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("comment extension entrypoint", () => {
  test("registers the comment command", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("comment")).toBe(true);
  });
});

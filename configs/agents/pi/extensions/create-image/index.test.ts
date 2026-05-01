import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("create-image extension entrypoint", () => {
  test("registers the create-image command", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("create-image")).toBe(true);
  });
});

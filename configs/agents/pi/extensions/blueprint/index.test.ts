import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import register from "./index";

describe("blueprint extension entrypoint", () => {
  test("registers the blueprint command", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    register(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("blueprint")).toBe(true);
  });
});

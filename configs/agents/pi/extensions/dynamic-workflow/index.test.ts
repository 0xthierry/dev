import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import register from "./index";

describe("dynamic workflow extension entrypoint", () => {
  test("registers the workflow tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    register(fakePi.pi);

    // Assert
    expect(fakePi.tools.has("workflow")).toBe(true);
  });
});

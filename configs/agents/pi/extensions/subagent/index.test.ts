import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import register from "./index";

describe("subagent extension entrypoint", () => {
  test("registers the Agent tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    register(fakePi.pi);

    // Assert
    expect(fakePi.tools.has("Agent")).toBe(true);
  });
});

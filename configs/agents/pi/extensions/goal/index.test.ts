import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import goalExtension from "./index";

describe("goal extension entrypoint", () => {
  test("registers the goal command and tools", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    goalExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("goal")).toBe(true);
    expect(fakePi.tools.has("get_goal")).toBe(true);
    expect(fakePi.tools.has("create_goal")).toBe(true);
    expect(fakePi.tools.has("update_goal")).toBe(true);
  });
});

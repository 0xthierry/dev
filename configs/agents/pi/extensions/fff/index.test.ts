import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import fffExtension from "./index";

describe("fff extension entrypoint", () => {
  test("registers the extension resources", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    fffExtension(fakePi.pi);

    // Assert
    expect(fakePi.tools.has("grep")).toBe(true);
    expect(fakePi.tools.has("find")).toBe(true);
    expect(fakePi.tools.has("multi_grep")).toBe(true);
    expect(fakePi.commands.has("fff-health")).toBe(true);
  });
});

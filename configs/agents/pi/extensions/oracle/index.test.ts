import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";
import { ORACLE_TOOL_NAME } from "./lib/tool";

describe("oracle extension entrypoint", () => {
  test("registers the oracle tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.tools.has(ORACLE_TOOL_NAME)).toBe(true);
  });
});

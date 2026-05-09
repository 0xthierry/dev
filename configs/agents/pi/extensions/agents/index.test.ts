import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("agents extension entrypoint", () => {
  test("registers agents context handlers", () => {
    // Arrange
    const fake = createFakePi();

    // Act
    registerExtension(fake.pi);

    // Assert
    expect(fake.handlers.has("session_start")).toBe(true);
    expect(fake.handlers.has("before_agent_start")).toBe(true);
    expect(fake.handlers.has("tool_call")).toBe(true);
  });
});

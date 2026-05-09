import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("project-rules extension entrypoint", () => {
  test("registers project rules handlers", () => {
    // Arrange
    const fake = createFakePi();

    // Act
    registerExtension(fake.pi);

    // Assert
    expect(fake.handlers.has("before_agent_start")).toBe(true);
    expect(fake.handlers.has("tool_call")).toBe(true);
    expect(fake.commands.has("rules")).toBe(true);
  });
});

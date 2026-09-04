import { expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

test("registers task-title lifecycle handlers", () => {
  // Arrange
  const fake = createFakePi();

  // Act
  registerExtension(fake.pi);

  // Assert
  expect(fake.handlers.has("input")).toBe(true);
  expect(fake.handlers.has("before_agent_start")).toBe(true);
});

import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("personality extension entrypoint", () => {
  test("registers the personality prompt handler", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.has("before_agent_start")).toBe(true);
  });
});

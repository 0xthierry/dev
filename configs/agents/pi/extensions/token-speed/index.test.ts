import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("token-speed extension entrypoint", () => {
  test("registers message lifecycle handlers", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.has("session_start")).toBe(true);
    expect(fakePi.handlers.has("message_update")).toBe(true);
    expect(fakePi.handlers.has("message_end")).toBe(true);
  });
});

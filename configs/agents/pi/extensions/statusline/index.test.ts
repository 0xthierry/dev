import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("statusline extension entrypoint", () => {
  test("registers statusline lifecycle handlers", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.has("session_start")).toBe(true);
    expect(fakePi.handlers.has("turn_end")).toBe(true);
    expect(fakePi.handlers.has("session_shutdown")).toBe(true);
  });
});

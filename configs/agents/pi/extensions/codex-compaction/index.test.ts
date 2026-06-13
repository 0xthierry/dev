import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import extension from "./index";

describe("codex-compaction extension", () => {
  test("registers compaction lifecycle handlers", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    extension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.has("session_before_compact")).toBe(true);
    expect(fakePi.handlers.has("before_provider_request")).toBe(true);
    expect(fakePi.handlers.has("after_provider_response")).toBe(true);
  });
});

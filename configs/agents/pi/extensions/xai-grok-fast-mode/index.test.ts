import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("xai-grok-fast-mode extension entrypoint", () => {
  test("registers Grok cache-affinity and compaction hooks", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.has("before_provider_request")).toBe(false);
    expect(fakePi.handlers.has("before_provider_headers")).toBe(true);
    expect(fakePi.handlers.has("turn_end")).toBe(true);
  });
});

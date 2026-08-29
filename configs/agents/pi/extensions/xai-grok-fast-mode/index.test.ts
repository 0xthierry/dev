import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

describe("xai-grok-fast-mode extension entrypoint", () => {
  test("registers the provider payload hook", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.has("before_provider_request")).toBe(true);
  });
});

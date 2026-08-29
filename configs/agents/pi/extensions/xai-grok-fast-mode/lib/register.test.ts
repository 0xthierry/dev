import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerXaiGrokFastModeExtension } from "./register";

describe("registerXaiGrokFastModeExtension", () => {
  test("registers a direct xAI Grok payload rewriter", async () => {
    // Arrange
    const fakePi = createFakePi();
    const payload = { model: "grok-4.6", input: [], stream: true };

    // Act
    registerXaiGrokFastModeExtension(fakePi.pi);
    const results = await fakePi.emit(
      "before_provider_request",
      { type: "before_provider_request", payload },
      { model: { provider: "xai", id: "grok-4.6" } },
    );

    // Assert
    expect(fakePi.handlers.get("before_provider_request")?.length).toBe(1);
    expect(results).toEqual([{ ...payload, service_tier: "priority" }]);
  });
});

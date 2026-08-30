import { describe, expect, test } from "bun:test";
import { applyXaiGrokCacheAffinity, XAI_GROK_CONVERSATION_HEADER } from "./cache-affinity";

describe("applyXaiGrokCacheAffinity", () => {
  test("routes direct xAI Grok requests with the Pi session id", () => {
    // Arrange
    const headers: Record<string, string | null> = { authorization: "Bearer test" };

    // Act
    const applied = applyXaiGrokCacheAffinity(headers, { provider: "xai", id: "grok-4.6" }, "session-123");

    // Assert
    expect(applied).toBe(true);
    expect(headers).toEqual({ authorization: "Bearer test", [XAI_GROK_CONVERSATION_HEADER]: "session-123" });
  });

  test("overrides a stale conversation id", () => {
    // Arrange
    const headers = { [XAI_GROK_CONVERSATION_HEADER]: "old-session" };

    // Act
    const applied = applyXaiGrokCacheAffinity(headers, { provider: "xai", id: "grok-4.5" }, "current-session");

    // Assert
    expect(applied).toBe(true);
    expect(headers[XAI_GROK_CONVERSATION_HEADER]).toBe("current-session");
  });

  test("leaves unrelated requests and missing session ids unchanged", () => {
    // Arrange
    const headers = { accept: "application/json" };

    // Act
    const results = [
      applyXaiGrokCacheAffinity(headers, { provider: "openrouter", id: "x-ai/grok-4.6" }, "session-123"),
      applyXaiGrokCacheAffinity(headers, { provider: "xai", id: "grok-4.6" }, undefined),
    ];

    // Assert
    expect(results).toEqual([false, false]);
    expect(headers).toEqual({ accept: "application/json" });
  });
});

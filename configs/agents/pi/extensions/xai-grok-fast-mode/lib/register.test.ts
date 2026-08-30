import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { XAI_GROK_CONVERSATION_HEADER } from "./cache-affinity";
import { registerXaiGrokFastModeExtension } from "./register";

type CompactCallbacks = {
  onComplete: () => void;
  onError: (error: Error) => void;
};

const grokModel = { provider: "xai", id: "grok-4.6", contextWindow: 500_000 };

describe("registerXaiGrokFastModeExtension", () => {
  test("registers direct xAI Grok request and context optimizations", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerXaiGrokFastModeExtension(fakePi.pi);

    // Assert
    expect(fakePi.handlers.get("before_provider_request")?.length).toBe(1);
    expect(fakePi.handlers.get("before_provider_headers")?.length).toBe(1);
    expect(fakePi.handlers.get("turn_end")?.length).toBe(1);
  });

  test("adds priority processing to direct xAI Grok payloads", async () => {
    // Arrange
    const fakePi = createFakePi();
    const payload = { model: "grok-4.6", input: [], stream: true };
    registerXaiGrokFastModeExtension(fakePi.pi);

    // Act
    const results = await fakePi.emit(
      "before_provider_request",
      { type: "before_provider_request", payload },
      { model: grokModel },
    );

    // Assert
    expect(results).toEqual([{ ...payload, service_tier: "priority" }]);
  });

  test("adds the stable Pi session id to direct xAI Grok headers", async () => {
    // Arrange
    const fakePi = createFakePi();
    const headers: Record<string, string | null> = { accept: "text/event-stream" };
    registerXaiGrokFastModeExtension(fakePi.pi);

    // Act
    await fakePi.emit("before_provider_headers", { type: "before_provider_headers", headers }, { model: grokModel });

    // Assert
    expect(headers[XAI_GROK_CONVERSATION_HEADER]).toBe("fake-session-id");
  });

  test("triggers stock Pi compaction at 85 percent of the Grok context window", async () => {
    // Arrange
    const fakePi = createFakePi();
    const compact = mock((_options: CompactCallbacks) => undefined);
    registerXaiGrokFastModeExtension(fakePi.pi);

    // Act
    await fakePi.emit("turn_end", {}, { model: grokModel, getContextUsage: () => ({ tokens: 425_000 }), compact });

    // Assert
    expect(compact).toHaveBeenCalledTimes(1);
    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({ onComplete: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  test("guards duplicate early compaction while the first trigger is in flight", async () => {
    // Arrange
    const fakePi = createFakePi();
    let callbacks: CompactCallbacks | undefined;
    const compact = mock((options: CompactCallbacks) => {
      callbacks = options;
    });
    registerXaiGrokFastModeExtension(fakePi.pi);
    const ctx = { model: grokModel, getContextUsage: () => ({ tokens: 425_001 }), compact };

    // Act
    await fakePi.emit("turn_end", {}, ctx);
    await fakePi.emit("turn_end", {}, ctx);
    callbacks?.onComplete();
    await fakePi.emit("turn_end", {}, ctx);

    // Assert
    expect(compact).toHaveBeenCalledTimes(2);
  });

  test("does not compact below the threshold or for proxy-routed Grok", async () => {
    // Arrange
    const fakePi = createFakePi();
    const compact = mock((_options: CompactCallbacks) => undefined);
    registerXaiGrokFastModeExtension(fakePi.pi);

    // Act
    await fakePi.emit("turn_end", {}, { model: grokModel, getContextUsage: () => ({ tokens: 424_999 }), compact });
    await fakePi.emit(
      "turn_end",
      {},
      {
        model: { provider: "openrouter", id: "x-ai/grok-4.6", contextWindow: 500_000 },
        getContextUsage: () => ({ tokens: 500_000 }),
        compact,
      },
    );

    // Assert
    expect(compact).toHaveBeenCalledTimes(0);
  });
});

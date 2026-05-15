import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { DEFAULT_TOKEN_SPEED_CONFIG, TOKEN_SPEED_STATUS_KEY } from "./constants";
import { TokenSpeedEngine } from "./engine";
import { registerTokenSpeed, type TokenSpeedRuntime } from "./register";

function createRuntime(engine: TokenSpeedEngine = new TokenSpeedEngine()): TokenSpeedRuntime {
  return {
    engine,
    loadConfig: mock(() => ({ config: DEFAULT_TOKEN_SPEED_CONFIG, warnings: ["watch the speed"] })),
  };
}

function createUiContext(setStatus = mock((_key: string, _text?: string) => undefined)) {
  return {
    hasUI: true,
    ui: {
      setStatus,
      notify: mock((_message: string, _type?: "info" | "warning" | "error") => undefined),
      theme: {
        fg: (name: string, text: string) => `${name}:${text}`,
      },
    },
  };
}

describe("registerTokenSpeed", () => {
  test("sets the idle status and reports config warnings on session start", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime();
    const setStatus = mock((_key: string, _text?: string) => undefined);
    const ctx = createUiContext(setStatus);
    registerTokenSpeed(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", {}, ctx);

    // Assert
    expect(runtime.loadConfig).toHaveBeenCalledTimes(1);
    expect(ctx.ui.notify).toHaveBeenCalledWith("watch the speed", "warning");
    expect(setStatus).toHaveBeenCalledWith(TOKEN_SPEED_STATUS_KEY, "dim:⚡ TPS: --");
  });

  test("updates the status from assistant streaming events", async () => {
    // Arrange
    let now = 0;
    const fakePi = createFakePi();
    const engine = new TokenSpeedEngine(() => now);
    const runtime = createRuntime(engine);
    const setStatus = mock((_key: string, _text?: string) => undefined);
    const ctx = createUiContext(setStatus);
    registerTokenSpeed(fakePi.pi, runtime);

    // Act
    await fakePi.emit("message_start", { message: { role: "assistant" } }, ctx);
    now = 100;
    await fakePi.emit(
      "message_update",
      { message: { role: "assistant" }, assistantMessageEvent: { type: "text_delta", delta: "Hello" } },
      ctx,
    );
    now = 500;
    await fakePi.emit("message_end", { message: { role: "assistant" } }, ctx);

    // Assert
    expect(engine.isStreaming).toBe(false);
    expect(setStatus.mock.calls.at(-1)).toEqual([
      TOKEN_SPEED_STATUS_KEY,
      "dim:⚡ TPS: \x1b[38;2;255;68;68m2.0 tok/s\x1b[0m",
    ]);
  });

  test("stops a dangling stream at turn end", async () => {
    // Arrange
    let now = 0;
    const fakePi = createFakePi();
    const engine = new TokenSpeedEngine(() => now);
    const runtime = createRuntime(engine);
    const setStatus = mock((_key: string, _text?: string) => undefined);
    const ctx = createUiContext(setStatus);
    registerTokenSpeed(fakePi.pi, runtime);

    // Act
    await fakePi.emit("message_start", { message: { role: "assistant" } }, ctx);
    now = 250;
    await fakePi.emit(
      "message_update",
      { message: { role: "assistant" }, assistantMessageEvent: { type: "thinking_delta", delta: "plan" } },
      ctx,
    );
    now = 500;
    await fakePi.emit("turn_end", {}, ctx);

    // Assert
    expect(engine.isStreaming).toBe(false);
    expect(setStatus.mock.calls.at(-1)?.[1]).toContain("2.0 tok/s");
  });

  test("does not touch config or UI when UI is unavailable", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime();
    registerTokenSpeed(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", {}, { hasUI: false });

    // Assert
    expect(runtime.loadConfig).not.toHaveBeenCalled();
  });
});

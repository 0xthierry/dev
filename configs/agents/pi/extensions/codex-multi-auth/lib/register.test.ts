import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerCodexMultiAuthExtension } from "./register";
import type { CodexMultiAuthRuntime } from "./runtime";

function readyRuntime() {
  const start = mock(async () => undefined);
  const close = mock(async () => undefined);
  const runtime: CodexMultiAuthRuntime = {
    prepare: mock(async () => ({
      state: "ready" as const,
      accountCount: 2,
      bridgeBaseUrl: "http://127.0.0.1:43210/v1",
      bridgeClientApiKey: "local-secret",
      start,
      close,
    })),
  };
  return { runtime, start, close };
}

describe("registerCodexMultiAuthExtension", () => {
  test("leaves Pi's native provider untouched when the account pool is empty", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime: CodexMultiAuthRuntime = {
      prepare: mock(async () => ({ state: "inactive" as const, reason: "no-accounts" as const })),
    };

    // Act
    await registerCodexMultiAuthExtension(fakePi.pi, runtime);
    await fakePi.runCommand("codex-multi-auth-status");

    // Assert
    expect(fakePi.providers.size).toBe(0);
    expect(fakePi.commands.has("codex-multi-auth-status")).toBe(true);
    expect(fakePi.handlers.size).toBe(0);
    expect(fakePi.uiNotifications[0]?.message).toContain("codex-multi-auth login --device-auth");
  });

  test("overrides the Codex provider and owns the proxy lifecycle", async () => {
    // Arrange
    const fakePi = createFakePi();
    const { runtime, start, close } = readyRuntime();

    // Act
    await registerCodexMultiAuthExtension(fakePi.pi, runtime);
    await fakePi.emit("session_start");
    await fakePi.runCommand("codex-multi-auth-status");
    await fakePi.emit("session_shutdown");

    // Assert
    expect(fakePi.providers.get("openai-codex")).toMatchObject({
      baseUrl: "http://127.0.0.1:43210/v1",
      api: "openai-responses",
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(fakePi.uiNotifications).toContainEqual({
      message: "Codex multi-account routing is active · 2 accounts",
      type: "info",
    });
  });

  test("shows a startup failure in interactive sessions", async () => {
    // Arrange
    const fakePi = createFakePi();
    const { runtime, start } = readyRuntime();
    start.mockImplementation(async () => {
      throw new Error("port unavailable");
    });
    await registerCodexMultiAuthExtension(fakePi.pi, runtime);

    // Act
    const started = fakePi.emit("session_start", {}, { hasUI: true });

    // Assert
    await expect(started).rejects.toThrow("port unavailable");
    expect(fakePi.uiNotifications).toEqual([
      { message: "Codex multi-account routing failed to start: port unavailable", type: "error" },
    ]);
  });
});

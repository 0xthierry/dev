import { describe, expect, mock, test } from "bun:test";
import type { CodexMultiAuthBackend, MultiAuthServer } from "./backend";
import { createCodexMultiAuthRuntime, createEphemeralBearerVerifier } from "./runtime";

function fakeServer(baseUrl: string): MultiAuthServer & { close: ReturnType<typeof mock> } {
  return { baseUrl, close: mock(async () => undefined) };
}

function fakeBackend(accountCount: number): CodexMultiAuthBackend {
  const runtimeServer = fakeServer("http://127.0.0.1:41001");
  const bridgeServer = fakeServer("http://127.0.0.1:41002");
  const ports = [41001, 41002];

  return {
    loadAccountManager: mock(async () => ({ getAccountCount: () => accountCount })),
    reserveLoopbackPort: mock(async () => ports.shift() ?? 0),
    startRuntimeProxy: mock(async () => runtimeServer),
    startLocalBridge: mock(async () => bridgeServer),
  };
}

describe("createCodexMultiAuthRuntime", () => {
  test("stays inactive when no managed account exists", async () => {
    // Arrange
    const backend = fakeBackend(0);

    // Act
    const activation = await createCodexMultiAuthRuntime(backend).prepare();

    // Assert
    expect(activation).toEqual({ state: "inactive", reason: "no-accounts" });
    expect(backend.reserveLoopbackPort).not.toHaveBeenCalled();
  });

  test("starts one authenticated loopback proxy chain and closes both servers", async () => {
    // Arrange
    const backend = fakeBackend(2);
    const activation = await createCodexMultiAuthRuntime(backend).prepare();
    if (activation.state !== "ready") throw new Error("Expected ready activation");

    // Act
    await Promise.all([activation.start(), activation.start()]);
    const bridgeOptions = (backend.startLocalBridge as ReturnType<typeof mock>).mock.calls[0]?.[0];
    const accepted = await bridgeOptions.verifyBearerToken(`Bearer ${activation.bridgeClientApiKey}`, 123);
    const rejected = await bridgeOptions.verifyBearerToken("Bearer wrong", 123);
    await activation.close();

    // Assert
    expect(activation.bridgeBaseUrl).toBe("http://127.0.0.1:41002/v1");
    expect(backend.startRuntimeProxy).toHaveBeenCalledTimes(1);
    expect(backend.startLocalBridge).toHaveBeenCalledTimes(1);
    expect(bridgeOptions.runtimeBaseUrl).toBe("http://127.0.0.1:41001");
    expect(bridgeOptions.requireAuth).toBe(true);
    expect(accepted).toMatchObject({ id: "pi-ephemeral-client", lastUsedAt: 123 });
    expect(rejected).toBeNull();
  });

  test("closes the runtime proxy when bridge startup fails", async () => {
    // Arrange
    const backend = fakeBackend(1);
    const runtimeServer = await backend.startRuntimeProxy({} as never);
    (backend.startRuntimeProxy as ReturnType<typeof mock>).mockClear();
    (backend.startRuntimeProxy as ReturnType<typeof mock>).mockImplementation(async () => runtimeServer);
    (backend.startLocalBridge as ReturnType<typeof mock>).mockImplementation(async () => {
      throw new Error("bridge unavailable");
    });
    const activation = await createCodexMultiAuthRuntime(backend).prepare();
    if (activation.state !== "ready") throw new Error("Expected ready activation");

    // Act
    const started = activation.start();

    // Assert
    await expect(started).rejects.toThrow("bridge unavailable");
    expect(runtimeServer.close).toHaveBeenCalledTimes(1);
  });
});

describe("createEphemeralBearerVerifier", () => {
  test("requires the exact bearer token", async () => {
    // Arrange
    const verify = createEphemeralBearerVerifier("secret-token");

    // Act
    const results = await Promise.all([
      verify("Bearer secret-token", 42),
      verify("Bearer secret-tokeN", 42),
      verify(null, 42),
    ]);

    // Assert
    expect(results[0]).toMatchObject({ label: "Pi", createdAt: 42, revokedAt: null });
    expect(results.slice(1)).toEqual([null, null]);
  });
});

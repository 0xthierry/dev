import { describe, expect, mock, test } from "bun:test";
import { createIpcClient, type IpcClientConnection, IpcClientError, type IpcClientRuntime } from "./client";
import { encodeIpcFrame, IPC_ERROR_MESSAGE_MAX_BYTES, IPC_PROTOCOL_VERSION, IPC_RECORD_LIMIT_BYTES } from "./protocol";

class FakeClientConnection implements IpcClientConnection {
  readonly writes: string[] = [];
  readonly write = mock((record: string) => this.writes.push(record));
  readonly close = mock(() => this.emitClose());
  private dataListeners = new Set<(chunk: Uint8Array | string) => void>();
  private closeListeners = new Set<(error?: Error) => void>();

  onData(listener: (chunk: Uint8Array | string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  emitData(chunk: Uint8Array | string): void {
    for (const listener of [...this.dataListeners]) listener(chunk);
  }

  emitClose(error?: Error): void {
    for (const listener of [...this.closeListeners]) listener(error);
  }
}

function harness(ids: string[], redact?: (value: string) => string) {
  const connection = new FakeClientConnection();
  const nextIds = [...ids];
  const runtime: IpcClientRuntime = {
    connect: mock(async () => connection),
    createRequestId: mock(() => nextIds.shift() ?? "unexpected-id"),
  };
  const client = createIpcClient({ socketPath: "/private/control.sock", token: "secret", runtime, redact });
  return { client, connection, runtime };
}

function parsedWrite(connection: FakeClientConnection, index: number): Record<string, unknown> {
  return JSON.parse(connection.writes[index] ?? "{}") as Record<string, unknown>;
}

function emitSuccess(connection: FakeClientConnection, id: string, result: unknown): void {
  connection.emitData(encodeIpcFrame({ version: IPC_PROTOCOL_VERSION, type: "response", id, ok: true, result }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForWrites(connection: FakeClientConnection, count: number): Promise<void> {
  for (let attempt = 0; attempt < 20 && connection.writes.length < count; attempt += 1) await Promise.resolve();
}

describe("IpcClient", () => {
  test("authenticates once and correlates concurrent responses by request identity", async () => {
    // Arrange
    const fake = harness(["auth", "one", "two"]);
    const first = fake.client.request("agent_list", {});
    const second = fake.client.request("agent_send", { target: "/root/parent", message: "hello" });
    await flush();
    expect(parsedWrite(fake.connection, 0)).toMatchObject({ id: "auth", operation: "authenticate" });

    // Act
    emitSuccess(fake.connection, "auth", { authenticated: true });
    await waitForWrites(fake.connection, 3);
    emitSuccess(fake.connection, "two", { delivery: "steered" });
    emitSuccess(fake.connection, "one", [{ agentId: "one" }]);

    // Assert
    await expect(first).resolves.toEqual([{ agentId: "one" }]);
    await expect(second).resolves.toEqual({ delivery: "steered" });
    expect(fake.runtime.connect).toHaveBeenCalledTimes(1);
    expect(parsedWrite(fake.connection, 1)).toMatchObject({ id: "one", operation: "agent_list" });
    expect(parsedWrite(fake.connection, 2)).toMatchObject({ id: "two", operation: "agent_send" });
  });

  test("propagates abort as a cancel frame and rejects only the pending request", async () => {
    // Arrange
    const fake = harness(["auth", "wait"]);
    const controller = new AbortController();
    const waiting = fake.client.request(
      "agent_wait",
      { targets: ["/root/parent"], condition: "all", timeout_seconds: 30 },
      controller.signal,
    );
    await flush();
    emitSuccess(fake.connection, "auth", { authenticated: true });
    await waitForWrites(fake.connection, 2);

    // Act
    controller.abort(new DOMException("stop waiting", "AbortError"));

    // Assert
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(parsedWrite(fake.connection, 2)).toEqual({
      version: IPC_PROTOCOL_VERSION,
      type: "cancel",
      id: "wait",
    });
    expect(fake.connection.close).not.toHaveBeenCalled();
  });

  test("rejects all correlated requests on disconnect without exposing control values", async () => {
    // Arrange
    const fake = harness(["auth", "list"]);
    const operation = fake.client.request("agent_list", {});
    await flush();
    emitSuccess(fake.connection, "auth", { authenticated: true });
    await flush();

    // Act
    fake.connection.emitClose(new Error("private details"));

    // Assert
    await expect(operation).rejects.toEqual(new IpcClientError("closed", "Collaboration connection closed"));
  });

  test("fails closed on malformed and oversized responses", async () => {
    // Arrange
    const malformed = harness(["auth"]);
    const malformedRequest = malformed.client.request("agent_list", {});
    await flush();
    const oversized = harness(["auth"]);
    const oversizedRequest = oversized.client.request("agent_list", {});
    const outcomesPromise = Promise.allSettled([malformedRequest, oversizedRequest]);
    await flush();

    // Act
    malformed.connection.emitData("not-json\n");
    oversized.connection.emitData(Buffer.alloc(IPC_RECORD_LIMIT_BYTES + 1, 0x61));
    const outcomes = await outcomesPromise;

    // Assert
    expect(outcomes).toEqual([
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({ kind: "authentication_failed" }),
      }),
      expect.objectContaining({
        status: "rejected",
        reason: expect.objectContaining({ kind: "authentication_failed" }),
      }),
    ]);
    expect(malformed.connection.close).toHaveBeenCalledTimes(1);
    expect(oversized.connection.close).toHaveBeenCalledTimes(1);
  });

  test("bounds authenticated remote error reflection to the shared hard cap", async () => {
    // Arrange
    const fake = harness(["auth", "list"]);
    const operation = fake.client.request("agent_list", {});
    await flush();
    emitSuccess(fake.connection, "auth", { authenticated: true });
    await waitForWrites(fake.connection, 2);

    // Act
    fake.connection.emitData(
      encodeIpcFrame({
        version: IPC_PROTOCOL_VERSION,
        type: "response",
        id: "list",
        ok: false,
        error: { kind: "invalid_path", message: "x".repeat(IPC_ERROR_MESSAGE_MAX_BYTES + 100) },
      }),
    );
    const error = await operation.catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(IpcClientError);
    expect(Buffer.byteLength((error as Error).message, "utf8")).toBe(IPC_ERROR_MESSAGE_MAX_BYTES);
  });

  test("redacts exact short secrets from authenticated remote errors", async () => {
    // Arrange
    const secret = "abc1234";
    const fake = harness(["auth", "list"], (value) => value.replaceAll(secret, "[REDACTED]"));
    const operation = fake.client.request("agent_list", {});
    await flush();
    emitSuccess(fake.connection, "auth", { authenticated: true });
    await waitForWrites(fake.connection, 2);

    // Act
    fake.connection.emitData(
      encodeIpcFrame({
        version: IPC_PROTOCOL_VERSION,
        type: "response",
        id: "list",
        ok: false,
        error: { kind: "unexpected", message: `reflected ${secret}` },
      }),
    );
    const error = (await operation.catch((caught: unknown) => caught)) as Error;

    // Assert
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain(secret);
  });

  test("closes explicitly and refuses later collaboration", async () => {
    // Arrange
    const fake = harness(["auth"]);

    // Act
    fake.client.close();
    const operation = fake.client.request("agent_list", {});

    // Assert
    await expect(operation).rejects.toMatchObject({ kind: "closed" });
    expect(fake.connection.close).not.toHaveBeenCalled();
  });
});

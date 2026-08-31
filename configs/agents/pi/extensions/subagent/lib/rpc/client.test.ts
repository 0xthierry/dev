import { describe, expect, mock, test } from "bun:test";
import { MAX_ARTIFACT_BYTES } from "../artifacts/artifacts";
import {
  PiRpcClient,
  RpcClientClosedError,
  RpcProtocolViolationError,
  RpcRequestError,
  type RpcTransport,
} from "./client";
import { JsonlCommandTooLargeError, MAX_OUTBOUND_JSONL_BYTES } from "./jsonl";

class FakeRpcTransport implements RpcTransport {
  readonly writes: string[] = [];
  readonly write = mock((record: string) => {
    this.writes.push(record);
  });
  private readonly dataListeners = new Set<(chunk: Uint8Array | string) => void>();
  private readonly closeListeners = new Set<(error?: Error) => void>();

  onData(listener: (chunk: Uint8Array | string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: (error?: Error) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  emit(value: Record<string, unknown>): void {
    const record = `${JSON.stringify(value)}\n`;
    for (const listener of [...this.dataListeners]) listener(record);
  }

  emitRaw(value: string): void {
    for (const listener of [...this.dataListeners]) listener(value);
  }

  close(error?: Error): void {
    for (const listener of [...this.closeListeners]) listener(error);
  }

  command(index = 0): Record<string, unknown> {
    return JSON.parse(this.writes[index] ?? "{}") as Record<string, unknown>;
  }
}

describe("PiRpcClient", () => {
  test("correlates concurrent responses by id instead of response order", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);

    // Act
    const statePromise = client.getState();
    const abortPromise = client.abort();
    const stateCommand = transport.command(0);
    const abortCommand = transport.command(1);
    transport.emit({ id: abortCommand.id, type: "response", command: "abort", success: true });
    transport.emit({
      id: stateCommand.id,
      type: "response",
      command: "get_state",
      success: true,
      data: stateData(),
    });

    // Assert
    await expect(abortPromise).resolves.toBeUndefined();
    await expect(statePromise).resolves.toMatchObject({
      model: { provider: "openai", id: "gpt-test" },
      thinkingLevel: "high",
    });
  });

  test("rejects an oversized encoded command before transport write", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const message = "x".repeat(MAX_OUTBOUND_JSONL_BYTES);

    // Act
    const request = client.prompt(message);

    // Assert
    await expect(request).rejects.toBeInstanceOf(JsonlCommandTooLargeError);
    expect(transport.write).not.toHaveBeenCalled();
  });

  test("resolves prompt on acceptance without waiting for agent settlement", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);

    // Act
    const promptPromise = client.prompt("Do the task");
    const command = transport.command();
    transport.emit({ id: command.id, type: "response", command: "prompt", success: true });

    // Assert
    await expect(promptPromise).resolves.toBeUndefined();
    expect(transport.writes).toHaveLength(1);
  });

  test("waits for agent_settled and treats fetched assistant text as a separate authoritative request", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const settled = client.waitForSettled();

    // Act
    transport.emit({ type: "agent_end", messages: [{ role: "assistant" }] });
    let didSettle = false;
    settled.then(() => {
      didSettle = true;
    });
    await Promise.resolve();
    transport.emit({ type: "agent_settled" });
    await settled;
    const textPromise = client.getLastAssistantText();
    const command = transport.command();
    transport.emit({
      id: command.id,
      type: "response",
      command: "get_last_assistant_text",
      success: true,
      data: { text: "authoritative output" },
    });

    // Assert
    expect(didSettle).toBe(true);
    await expect(textPromise).resolves.toBe("authoritative output");
  });

  test("receives a maximum storable assistant output under worst-case JSON escaping", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const output = "\0".repeat(MAX_ARTIFACT_BYTES);
    const request = client.getLastAssistantText();
    const command = transport.command();

    // Act
    transport.emit({
      id: command.id,
      type: "response",
      command: "get_last_assistant_text",
      success: true,
      data: { text: output },
    });

    // Assert
    await expect(request).resolves.toBe(output);
  });

  test("automatically cancels every blocking extension UI request", () => {
    // Arrange
    const transport = new FakeRpcTransport();
    new PiRpcClient(transport);

    // Act
    for (const method of ["select", "confirm", "input", "editor"]) {
      transport.emit({ type: "extension_ui_request", id: `ui-${method}`, method });
    }
    transport.emit({ type: "extension_ui_request", id: "ui-notify", method: "notify" });

    // Assert
    expect(transport.writes.map((record) => JSON.parse(record))).toEqual([
      { type: "extension_ui_response", id: "ui-select", cancelled: true },
      { type: "extension_ui_response", id: "ui-confirm", cancelled: true },
      { type: "extension_ui_response", id: "ui-input", cancelled: true },
      { type: "extension_ui_response", id: "ui-editor", cancelled: true },
    ]);
  });

  test("rejects failed commands with a typed request error", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);

    // Act
    const request = client.setModel("missing", "model");
    const command = transport.command();
    transport.emit({
      id: command.id,
      type: "response",
      command: "set_model",
      success: false,
      error: "Model not found",
    });

    // Assert
    await expect(request).rejects.toBeInstanceOf(RpcRequestError);
  });

  test("redacts exact short secrets from malformed and mismatched response errors", async () => {
    // Arrange
    const secret = "abc1234";
    const malformedTransport = new FakeRpcTransport();
    const malformedClient = new PiRpcClient(malformedTransport, {
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
    });
    const malformedRequest = malformedClient.getState();
    const mismatchTransport = new FakeRpcTransport();
    const mismatchClient = new PiRpcClient(mismatchTransport, {
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
    });
    const mismatchRequest = mismatchClient.getState();
    const command = mismatchTransport.command();

    // Act
    malformedTransport.emitRaw(`{"value":"${secret}" trailing\n`);
    mismatchTransport.emit({ id: command.id, type: "response", command: secret, success: true });
    const errors = await Promise.all([
      malformedRequest.then<Error, Error>(
        () => new Error("Expected malformed response rejection"),
        (error: unknown) => error as Error,
      ),
      mismatchRequest.then<Error, Error>(
        () => new Error("Expected mismatched response rejection"),
        (error: unknown) => error as Error,
      ),
    ]);

    // Assert
    for (const error of errors) {
      expect(error.message).toContain("[REDACTED]");
      expect(error.message).not.toContain(secret);
    }
  });

  test("fails closed on malformed JSONL and rejects pending requests", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const request = client.getState();

    // Act
    transport.emitRaw("not-json\n");

    // Assert
    await expect(request).rejects.toThrow("Invalid RPC JSONL");
    await expect(client.abort()).rejects.toThrow("Invalid RPC JSONL");
  });

  test("rejects a mismatched correlated response as a protocol violation", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const request = client.getState();
    const command = transport.command();

    // Act
    transport.emit({ id: command.id, type: "response", command: "abort", success: true });

    // Assert
    await expect(request).rejects.toBeInstanceOf(RpcProtocolViolationError);
  });

  test("removes an aborted request and ignores its late response", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const controller = new AbortController();
    const request = client.getState({ signal: controller.signal });
    const command = transport.command();

    // Act
    controller.abort();
    transport.emit({ id: command.id, type: "response", command: "get_state", success: true, data: stateData() });
    const next = client.abort();
    const nextCommand = transport.command(1);
    transport.emit({ id: nextCommand.id, type: "response", command: "abort", success: true });

    // Assert
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    await expect(next).resolves.toBeUndefined();
  });

  test("rejects requests and settlement waiters when the transport closes", async () => {
    // Arrange
    const transport = new FakeRpcTransport();
    const client = new PiRpcClient(transport);
    const request = client.getState();
    const settled = client.waitForSettled();

    const requestResult = request.catch((error: unknown) => error);
    const settledResult = settled.catch((error: unknown) => error);

    // Act
    transport.close();

    // Assert
    expect(await requestResult).toBeInstanceOf(RpcClientClosedError);
    expect(await settledResult).toBeInstanceOf(RpcClientClosedError);
  });
});

function stateData(): Record<string, unknown> {
  return {
    model: { provider: "openai", id: "gpt-test" },
    thinkingLevel: "high",
    isStreaming: false,
    isCompacting: false,
    sessionFile: "/sessions/child.jsonl",
    sessionId: "child-id",
    pendingMessageCount: 0,
  };
}

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { BrowserUseApprovalHandler, BrowserUseApprovalResponse } from "./approval";
import { BrowserUseTransportError, createBrowserUseKernel, type JsonRpcMessage } from "./kernel";
import type { BrowserUsePaths } from "./paths";

const paths: BrowserUsePaths = {
  available: true,
  nodeRepl: "/tmp/node_repl",
  node: "/tmp/node",
  nodeModules: "/tmp/modules",
  browserClient: "/tmp/browser-client.mjs",
  browserService: "/tmp/browser-service.mjs",
  codexHome: "/tmp/codex",
  codexCli: "/tmp/codex-cli",
};

afterEach(() => mock.restore());

describe("createBrowserUseKernel", () => {
  test("shares a turn across calls, ends it once, and preserves the process for the next turn", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    // Act
    await kernel.endTurn();
    const result = await kernel.execute("const retained = 1;");
    await kernel.execute("nodeRepl.write(retained);");
    await kernel.endTurn();
    await kernel.endTurn();
    await kernel.execute("nodeRepl.write(retained);");
    // Assert
    expect(result).toEqual(expect.objectContaining({ text: "ran", isError: false }));
    const calls = child.messages.filter((message) => message.method === "tools/call");
    const params = calls.map((message) => message.params) as Array<{
      name: string;
      arguments: Record<string, unknown>;
      _meta: Record<string, unknown>;
    }>;
    expect(params.map((param) => param.name)).toEqual(["js", "js", "turn_ended", "js"]);
    expect(params[0]?._meta).toEqual(params[1]?._meta);
    expect(params[2]?._meta).toEqual(params[1]?._meta);
    expect(params[3]?._meta).not.toEqual(params[0]?._meta);
    const ended = params[2]?.arguments;
    expect(ended).toEqual({ hook_event_name: "Stop", session_id: expect.any(String), turn_id: expect.any(String) });
    expect(JSON.stringify(params[0]?._meta)).toContain(String(ended?.session_id));
    expect(JSON.stringify(params[0]?._meta)).toContain(String(ended?.turn_id));
    expect(JSON.stringify(params[3]?._meta)).toContain(String(ended?.session_id));
    expect(child.kill).not.toHaveBeenCalled();
    expect(child.messages.every((message) => message.jsonrpc === "2.0")).toBe(true);
    await kernel.close();
  });

  for (const failure of ["rpc", "mcp"] as const) {
    test(`failed ${failure} turn cleanup disposes the ambiguous turn and prevents later execution`, async () => {
      // Arrange
      const child = new FakeProcess();
      const kernel = await createBrowserUseKernel(paths, () => child.process);
      await kernel.execute("const retained = 1");
      if (failure === "rpc") child.rpcError = { code: -32603, message: "SECRET_CREDENTIAL" };
      else child.rpcResult = { content: [{ type: "text", text: "SECRET_CREDENTIAL" }], isError: true };
      // Act
      const cleanup = kernel.endTurn();
      // Assert
      await expect(cleanup).rejects.toBeInstanceOf(BrowserUseTransportError);
      await expect(cleanup).rejects.toThrow("bindings were lost");
      await expect(cleanup).rejects.not.toThrow("SECRET_CREDENTIAL");
      expect(kernel.closed).toBe(true);
      expect(child.kill).toHaveBeenCalledTimes(1);
      await expect(kernel.execute("doNotRun()")).rejects.toBeInstanceOf(BrowserUseTransportError);
      await kernel.endTurn();
      expect(child.messages.filter((message) => message.method === "tools/call")).toHaveLength(2);
      await kernel.close();
    });
  }

  // Fixtures for upstream node_repl's unstructured VM-reset wire messages.
  const resetMessages = [
    "js execution timed out; kernel reset, rerun your request",
    "js sandbox changed; kernel reset, rerun your request",
  ];
  for (const message of resetMessages) {
    for (const envelope of ["mcp", "rpc"] as const) {
      test(`disposes without replay for ${envelope} VM reset: ${message}`, async () => {
        // Arrange
        const child = new FakeProcess();
        const kernel = await createBrowserUseKernel(paths, () => child.process);
        if (envelope === "mcp") child.rpcResult = { content: [{ type: "text", text: message }], isError: true };
        else child.rpcError = { code: -32603, message };
        // Act
        const execution = kernel.execute("sideEffectBeforeReset()");
        // Assert
        await expect(execution).rejects.toBeInstanceOf(BrowserUseTransportError);
        await expect(execution).rejects.toThrow("bindings were lost");
        expect(kernel.closed).toBe(true);
        expect(child.kill).toHaveBeenCalledTimes(1);
        expect(child.messages.filter((sent) => sent.method === "tools/call")).toHaveLength(1);
        await expect(kernel.execute("doNotReplay()")).rejects.toBeInstanceOf(BrowserUseTransportError);
        await kernel.close();
      });
    }
  }

  test("ordinary JavaScript errors preserve the kernel and its active turn", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.rpcResult = { content: [{ type: "text", text: "ReferenceError: missing is not defined" }], isError: true };
    // Act
    const result = await kernel.execute("missing()");
    child.rpcResult = { content: [{ type: "text", text: "ran" }], isError: false };
    await kernel.execute("const retained = 1");
    // Assert
    expect(result).toEqual(expect.objectContaining({ text: "ReferenceError: missing is not defined", isError: true }));
    expect(kernel.closed).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    const calls = child.messages.filter((message) => message.method === "tools/call");
    expect((calls[0]?.params as { _meta: unknown })._meta).toEqual((calls[1]?.params as { _meta: unknown })._meta);
    await kernel.close();
  });

  test("successful output quoting a VM-reset message does not invalidate bindings", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.rpcResult = { content: [{ type: "text", text: resetMessages[0] }], isError: false };
    // Act
    const result = await kernel.execute("nodeRepl.write(message)");
    // Assert
    expect(result.isError).toBe(false);
    expect(kernel.closed).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
    await kernel.close();
  });

  for (const action of ["accept", "decline", "cancel"] as const) {
    test(`elicitation forwards the handler's explicit ${action} decision`, async () => {
      // Arrange
      const child = new FakeProcess();
      const response: BrowserUseApprovalResponse = {
        action,
        ...(action === "accept" ? { content: { approved: true } } : {}),
      };
      const handler = mock<BrowserUseApprovalHandler>(async () => response);
      const kernel = await createBrowserUseKernel(paths, () => child.process, handler);
      const params = { message: "Private origin prompt", requestedSchema: { type: "object" } };
      // Act
      child.send({ jsonrpc: "2.0", id: "approval", method: "elicitation/create", params });
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Assert
      expect(child.messages[0]?.params).toMatchObject({ capabilities: { elicitation: {} } });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(params, expect.any(AbortSignal));
      expect(handler.mock.calls[0]?.[1].aborted).toBe(false);
      expect(child.messages).toContainEqual({ jsonrpc: "2.0", id: "approval", result: response });
      await kernel.close();
      expect(handler.mock.calls[0]?.[1].aborted).toBe(true);
    });
  }

  test("without an approval handler does not advertise or approve elicitation", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    // Act
    child.send({ jsonrpc: "2.0", id: 70, method: "elicitation/create", params: { message: "Private prompt" } });
    // Assert
    expect(child.messages[0]?.params).toMatchObject({ capabilities: {} });
    expect(child.messages).toContainEqual({
      jsonrpc: "2.0",
      id: 70,
      error: { code: -32601, message: "Method not found" },
    });
    await kernel.close();
  });

  for (const throwsSynchronously of [false, true]) {
    test(`approval handler failure cancels without exposing errors (synchronous: ${throwsSynchronously})`, async () => {
      // Arrange
      const child = new FakeProcess();
      const handler = mock<BrowserUseApprovalHandler>(() => {
        if (throwsSynchronously) throw new Error("SECRET_CREDENTIAL");
        return Promise.reject(new Error("SECRET_CREDENTIAL"));
      });
      const kernel = await createBrowserUseKernel(paths, () => child.process, handler);
      const log = spyOn(console, "error").mockImplementation(() => undefined);
      // Act
      child.send({ jsonrpc: "2.0", id: 71, method: "elicitation/create", params: { message: "SECRET_PROMPT" } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Assert
      expect(child.messages).toContainEqual({ jsonrpc: "2.0", id: 71, result: { action: "cancel" } });
      expect(JSON.stringify(child.messages)).not.toContain("SECRET");
      expect(log).not.toHaveBeenCalled();
      expect(kernel.closed).toBe(false);
      await kernel.close();
    });
  }

  for (const termination of ["abort", "exit", "close"] as const) {
    test(`pending approval is canceled on ${termination} and its late acceptance is discarded`, async () => {
      // Arrange
      const child = new FakeProcess();
      let decide!: (response: BrowserUseApprovalResponse) => void;
      const decision = new Promise<BrowserUseApprovalResponse>((resolve) => {
        decide = resolve;
      });
      const handler = mock<BrowserUseApprovalHandler>(() => decision);
      const kernel = await createBrowserUseKernel(paths, () => child.process, handler);
      const controller = new AbortController();
      child.respond = false;
      const execution = kernel.execute("await navigate()", controller.signal);
      const rejectedExecution = execution.catch((error: unknown) => error);
      child.send({ jsonrpc: "2.0", id: "pending-approval", method: "elicitation/create", params: {} });
      // Act
      if (termination === "abort") controller.abort();
      else if (termination === "exit") child.emit("exit", 1, null);
      else await kernel.close();
      decide({ action: "accept" });
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Assert
      expect(await rejectedExecution).toBeInstanceOf(BrowserUseTransportError);
      expect(handler.mock.calls[0]?.[1].aborted).toBe(true);
      expect(child.messages.some((message) => message.id === "pending-approval")).toBe(false);
      expect(kernel.closed).toBe(true);
      await kernel.close();
    });
  }

  test("pending elicitation does not block ping and unknown methods remain unsupported", async () => {
    // Arrange
    const child = new FakeProcess();
    let decide!: (response: BrowserUseApprovalResponse) => void;
    const handler = mock<BrowserUseApprovalHandler>(
      () =>
        new Promise((resolve) => {
          decide = resolve;
        }),
    );
    const kernel = await createBrowserUseKernel(paths, () => child.process, handler);
    // Act
    child.send({ jsonrpc: "2.0", id: "pending", method: "elicitation/create", params: {} });
    child.send({ jsonrpc: "2.0", id: "ping", method: "ping" });
    child.send({ jsonrpc: "2.0", id: "unknown", method: "requestApproval" });
    // Assert
    expect(handler).toHaveBeenCalledTimes(1);
    expect(child.messages).toContainEqual({ jsonrpc: "2.0", id: "ping", result: {} });
    expect(child.messages).toContainEqual({
      jsonrpc: "2.0",
      id: "unknown",
      error: { code: -32601, message: "Method not found" },
    });
    decide({ action: "decline" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(child.messages).toContainEqual({ jsonrpc: "2.0", id: "pending", result: { action: "decline" } });
    await kernel.close();
  });

  test("answers string-ID ping and refuses unknown server requests instead of approving them", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    // Act
    child.send({ jsonrpc: "2.0", id: "ping-1", method: "ping" });
    child.send({ jsonrpc: "2.0", id: "approve-1", method: "requestApproval" });
    // Assert
    expect(child.messages).toContainEqual({ jsonrpc: "2.0", id: "ping-1", result: {} });
    expect(child.messages).toContainEqual({
      jsonrpc: "2.0",
      id: "approve-1",
      error: { code: -32601, message: "Method not found" },
    });
    await kernel.close();
  });

  for (const alreadyAborted of [true, false]) {
    test(`disposes on abort (already aborted: ${alreadyAborted}) without replay`, async () => {
      // Arrange
      const child = new FakeProcess();
      const kernel = await createBrowserUseKernel(paths, () => child.process);
      child.respond = false;
      const controller = new AbortController();
      if (alreadyAborted) controller.abort();
      // Act
      const execution = kernel.execute("dangerousSideEffect()", controller.signal);
      controller.abort();
      // Assert
      await expect(execution).rejects.toBeInstanceOf(BrowserUseTransportError);
      expect(kernel.closed).toBe(true);
      expect(child.kill).toHaveBeenCalledTimes(1);
      expect(child.messages.filter((message) => message.method === "tools/call")).toHaveLength(alreadyAborted ? 0 : 1);
      await expect(kernel.execute("doNotReplay()")).rejects.toThrow("bindings were lost");
      await kernel.endTurn();
      await kernel.close();
      expect(child.kill).toHaveBeenCalledTimes(1);
    });
  }

  for (const source of ["process", "stdin", "stdout", "stderr"] as const) {
    test(`handles ${source} errors with a sanitized fatal error`, async () => {
      // Arrange
      const child = new FakeProcess();
      const kernel = await createBrowserUseKernel(paths, () => child.process);
      child.respond = false;
      const execution = kernel.execute("pending()");
      // Act
      const emitter: EventEmitter = source === "process" ? child : child[source];
      emitter.emit("error", new Error("SECRET_CREDENTIAL"));
      // Assert
      await expect(execution).rejects.toBeInstanceOf(BrowserUseTransportError);
      await expect(execution).rejects.not.toThrow("SECRET_CREDENTIAL");
      expect(kernel.closed).toBe(true);
      await kernel.close();
    });
  }

  test("cleans up an initialization failure without exposing server error data", async () => {
    // Arrange
    const child = new FakeProcess();
    child.rpcError = { message: "SECRET_CREDENTIAL" };
    // Act
    const creation = createBrowserUseKernel(paths, () => child.process);
    // Assert
    await expect(creation).rejects.toBeInstanceOf(BrowserUseTransportError);
    await expect(creation).rejects.not.toThrow("SECRET_CREDENTIAL");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("wraps synchronous spawn failures", async () => {
    // Arrange
    const spawn = mock((): ChildProcessWithoutNullStreams => {
      throw new Error("SECRET_CREDENTIAL");
    });
    // Act
    const creation = createBrowserUseKernel(paths, spawn);
    // Assert
    await expect(creation).rejects.toBeInstanceOf(BrowserUseTransportError);
    await expect(creation).rejects.not.toThrow("SECRET_CREDENTIAL");
  });

  test("cleans up an asynchronous spawn error during initialization", async () => {
    // Arrange
    const child = new FakeProcess();
    child.respond = false;
    const creation = createBrowserUseKernel(paths, () => child.process);
    // Act
    child.emit("error", new Error("SECRET_CREDENTIAL"));
    // Assert
    await expect(creation).rejects.toBeInstanceOf(BrowserUseTransportError);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("close rejects pending work and does not send a turn-ended request", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.respond = false;
    const execution = kernel.execute("pending()");
    // Act
    await kernel.close();
    await kernel.endTurn();
    // Assert
    await expect(execution).rejects.toBeInstanceOf(BrowserUseTransportError);
    expect(child.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  test("a JSON-RPC error is sanitized without discarding a healthy kernel", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.rpcError = { message: "SECRET_CREDENTIAL" };
    // Act
    const execution = kernel.execute("badCall()");
    // Assert
    await expect(execution).rejects.toThrow("rejected the JSON-RPC request");
    await expect(execution).rejects.not.toThrow("SECRET_CREDENTIAL");
    expect(kernel.closed).toBe(false);
    child.rpcError = undefined;
    await expect(kernel.execute("1")).resolves.toEqual(expect.objectContaining({ text: "ran", isError: false }));
    await kernel.close();
  });

  test("handles callback stdin write failures", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    spyOn(child.stdin, "write").mockImplementation(((_chunk: unknown, callback: (error: Error) => void) => {
      callback(new Error("SECRET_CREDENTIAL"));
      return false;
    }) as typeof child.stdin.write);
    // Act
    const execution = kernel.execute("pending()");
    // Assert
    await expect(execution).rejects.toThrow("input failed");
    expect(kernel.closed).toBe(true);
    await kernel.close();
  });

  test("handles synchronous stdin write failures", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    spyOn(child.stdin, "write").mockImplementation(() => {
      throw new Error("SECRET_CREDENTIAL");
    });
    // Act
    const execution = kernel.execute("pending()");
    // Assert
    await expect(execution).rejects.toThrow("input failed");
    expect(kernel.closed).toBe(true);
    await kernel.close();
  });

  test("request timeout terminates unknown execution and escalates an unresponsive child", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.respond = false;
    child.exitOnKill = false;
    shortenTimers();
    // Act
    const execution = kernel.execute("neverFinishes()");
    // Assert
    await expect(execution).rejects.toThrow("timed out");
    expect(kernel.closed).toBe(true);
    await kernel.close();
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });

  test("initialization timeout also disposes the child", async () => {
    // Arrange
    const child = new FakeProcess();
    child.respond = false;
    shortenTimers();
    // Act
    const creation = createBrowserUseKernel(paths, () => child.process);
    // Assert
    await expect(creation).rejects.toThrow("timed out");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  test("exit rejects pending work and close is immediate and idempotent without signalling an exited child", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.respond = false;
    const execution = kernel.execute("pending()");
    // Act
    child.emit("exit", 17, null);
    await kernel.close();
    await kernel.close();
    // Assert
    await expect(execution).rejects.toThrow("code 17");
    expect(kernel.closed).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("drains large stderr without retaining or exposing it", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    // Act
    child.stderr.write("SECRET_CREDENTIAL".repeat(100_000));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const result = await kernel.execute("1");
    // Assert
    expect(child.stderr.readableLength).toBe(0);
    expect(result).toEqual(expect.objectContaining({ text: "ran", isError: false }));
    await kernel.close();
  });

  test("invalid protocol envelopes are fatal", async () => {
    // Arrange
    const child = new FakeProcess();
    const kernel = await createBrowserUseKernel(paths, () => child.process);
    child.respond = false;
    const execution = kernel.execute("pending()");
    // Act
    child.stdout.write('{"id":2,"result":{}}\n');
    // Assert
    await expect(execution).rejects.toThrow("invalid JSON-RPC");
    expect(kernel.closed).toBe(true);
    await kernel.close();
  });
});

function shortenTimers(): void {
  const original = globalThis.setTimeout;
  spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) =>
    original(callback, 1)) as typeof setTimeout);
}

class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly messages: JsonRpcMessage[] = [];
  respond = true;
  exitOnKill = true;
  rpcError: unknown;
  rpcResult: unknown = { content: [{ type: "text", text: "ran" }], isError: false };
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly kill = mock((signal: NodeJS.Signals) => {
    if (this.exitOnKill) {
      this.signalCode = signal;
      this.emit("exit", null, signal);
      this.emit("close", null, signal);
    }
    return true;
  });

  constructor() {
    super();
    this.stdin.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split("\n")) {
        const message = JSON.parse(line) as JsonRpcMessage;
        this.messages.push(message);
        if (!this.respond || !message.method || message.id === undefined) continue;
        this.send({
          jsonrpc: "2.0",
          id: message.id,
          ...(this.rpcError ? { error: this.rpcError } : { result: this.rpcResult }),
        });
      }
    });
  }

  get process(): ChildProcessWithoutNullStreams {
    return this as unknown as ChildProcessWithoutNullStreams;
  }

  send(message: JsonRpcMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

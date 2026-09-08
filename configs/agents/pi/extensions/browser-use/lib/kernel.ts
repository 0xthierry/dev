import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface, type Interface } from "node:readline";
import type { BrowserUseApprovalHandler, BrowserUseApprovalResponse } from "./approval";
import { type BrowserUsePaths, buildBrowserUseEnvironment } from "./paths";
import type { BrowserUseExecutionResult } from "./result";
import { createTurnMetadata, parseBrowserUseToolResult } from "./result";

export type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

export interface BrowserUseKernel {
  execute(code: string, signal?: AbortSignal): Promise<BrowserUseExecutionResult>;
  endTurn(): Promise<void>;
  close(): Promise<void>;
  readonly closed: boolean;
}

/** Fatal failures invalidate bindings. Callers may recreate, but must never replay code. */
export class BrowserUseTransportError extends Error {
  constructor(reason: string) {
    super(
      `${reason} Browser kernel bindings were lost. Start a new kernel; do not automatically replay the failed code.`,
    );
    this.name = "BrowserUseTransportError";
  }
}

export type SpawnKernel = (paths: BrowserUsePaths) => ChildProcessWithoutNullStreams;

export function spawnBrowserUseProcess(paths: BrowserUsePaths): ChildProcessWithoutNullStreams {
  return spawn(paths.nodeRepl, ["--disable-sandbox"], {
    env: buildBrowserUseEnvironment(paths),
    stdio: "pipe",
  });
}

export async function createBrowserUseKernel(
  paths: BrowserUsePaths,
  spawnKernel: SpawnKernel = spawnBrowserUseProcess,
  approvalHandler?: BrowserUseApprovalHandler,
): Promise<BrowserUseKernel> {
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnKernel(paths);
  } catch {
    throw new BrowserUseTransportError("Could not start the browser kernel.");
  }
  const client = new StdioJsonRpcClient(child, approvalHandler);
  const sessionId = randomUUID();
  let turnId: string | undefined;
  try {
    await client.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: approvalHandler ? { elicitation: {} } : {},
        clientInfo: { name: "pi-browser-use", version: "0.1.0" },
      },
      20_000,
    );
    client.notify("notifications/initialized");
  } catch (error) {
    await client.close();
    throw error instanceof BrowserUseTransportError
      ? error
      : new BrowserUseTransportError("Browser kernel initialization failed.");
  }
  return {
    get closed() {
      return client.closed;
    },
    async execute(code, signal) {
      turnId ??= randomUUID();
      const result = await client.request(
        "tools/call",
        {
          name: "js",
          arguments: { code, timeout_ms: 45_000, title: "browser_use" },
          _meta: createTurnMetadata(sessionId, turnId),
        },
        60_000,
        signal,
      );
      const parsed = parseBrowserUseToolResult(result);
      if (parsed.isError && parsed.content.some((block) => block.type === "text" && isKernelResetMessage(block.text))) {
        await client.close();
        throw new BrowserUseTransportError("Browser kernel reset its JavaScript sandbox.");
      }
      return parsed;
    },
    async endTurn() {
      if (!turnId || client.closed) return;
      const endedTurn = turnId;
      try {
        const result = await client.request(
          "tools/call",
          {
            name: "turn_ended",
            arguments: { hook_event_name: "Stop", session_id: sessionId, turn_id: endedTurn },
            _meta: createTurnMetadata(sessionId, endedTurn),
          },
          20_000,
        );
        if (parseBrowserUseToolResult(result).isError) {
          throw new BrowserUseTransportError("Browser kernel turn cleanup failed.");
        }
        turnId = undefined;
      } catch {
        // A failed cleanup leaves turn ownership ambiguous. Never run more code in it.
        await client.close();
        throw new BrowserUseTransportError("Browser kernel turn cleanup failed.");
      }
    },
    close: () => client.close(),
  };
}

// Upstream node_repl currently reports VM resets as text rather than a structured code.
// Keep this wire-contract compatibility check here, never in Pi tool handlers.
function isKernelResetMessage(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.includes("js execution timed out; kernel reset, rerun your request") ||
      value.includes("js sandbox changed; kernel reset, rerun your request"))
  );
}

type Waiter = { resolve: (value: unknown) => void; reject: (error: Error) => void };

class StdioJsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<number | string, Waiter>();
  private readonly reader: Interface;
  private readonly lifetime = new AbortController();
  private disposal: Promise<void> | undefined;
  private finishDisposal: (() => void) | undefined;
  private exited = false;
  closed = false;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly approvalHandler?: BrowserUseApprovalHandler,
  ) {
    this.reader = createInterface({ input: child.stdout });
    this.reader.on("line", (line) => this.receive(line));
    this.reader.on("error", () => this.fail("Browser kernel output failed."));
    // Drain without retaining any stderr bytes: bounded memory and no secret leakage.
    child.stderr.resume();
    child.on("error", () => this.fail("Browser kernel process failed."));
    child.stdin.on("error", () => this.fail("Browser kernel input failed."));
    child.stdout.on("error", () => this.fail("Browser kernel output failed."));
    child.stderr.on("error", () => this.fail("Browser kernel diagnostic stream failed."));
    child.stdout.on("end", () => this.fail("Browser kernel output ended."));
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      this.exited = true;
      this.fail(`Browser kernel exited (code ${code ?? "none"}, signal ${signal ?? "none"}).`);
      this.finishDisposal?.();
    };
    child.once("exit", exited);
    child.once("close", exited);
    if (child.exitCode != null || child.signalCode != null) exited(child.exitCode, child.signalCode);
  }

  notify(method: string): void {
    this.write({ jsonrpc: "2.0", method });
    if (this.closed) throw new BrowserUseTransportError("Browser kernel is closed.");
  }

  request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) this.fail("Browser kernel execution was aborted.");
    if (this.closed) return Promise.reject(new BrowserUseTransportError("Browser kernel is closed."));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => this.fail("Browser kernel execution was aborted.");
      const timeout = setTimeout(() => this.fail("Browser kernel request timed out."), timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      this.pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  close(): Promise<void> {
    this.fail("Browser kernel was closed.");
    return this.disposal ?? Promise.resolve();
  }

  private receive(line: string): void {
    if (this.closed || !line.trim()) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
      if (!message || message.jsonrpc !== "2.0") throw new Error("Invalid envelope");
    } catch {
      this.fail("Browser kernel sent an invalid JSON-RPC message.");
      return;
    }
    if (message.method) {
      if (message.id !== undefined) {
        if (message.method === "elicitation/create" && this.approvalHandler) {
          void this.elicit(message.id, message.params, this.approvalHandler);
          return;
        }
        this.write(
          message.method === "ping"
            ? { jsonrpc: "2.0", id: message.id, result: {} }
            : { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } },
        );
      }
      return;
    }
    if (message.id === undefined) return;
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    if (message.error !== undefined) {
      // Server errors can contain code, credentials, or stderr; never forward raw data.
      if (
        typeof message.error === "object" &&
        message.error !== null &&
        "message" in message.error &&
        isKernelResetMessage(message.error.message)
      ) {
        this.fail("Browser kernel reset its JavaScript sandbox.");
      } else {
        waiter.reject(new Error("Browser kernel rejected the JSON-RPC request."));
      }
    } else {
      waiter.resolve(message.result);
    }
  }

  private async elicit(id: number | string, params: unknown, handler: BrowserUseApprovalHandler): Promise<void> {
    let result: BrowserUseApprovalResponse;
    try {
      result = await handler(params, this.lifetime.signal);
    } catch {
      // Prompt/UI failures must fail closed, without leaking request or error content.
      result = { action: "cancel" };
    }
    // The handler can finish after abort or process exit. Never send a stale decision.
    if (!this.closed) this.write({ jsonrpc: "2.0", id, result });
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.lifetime.abort();
    this.reader.close();
    const error = new BrowserUseTransportError(reason);
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    if (this.exited) {
      this.disposal = Promise.resolve();
      return;
    }
    // Set the promise before kill: a fake or already-exiting child can emit synchronously.
    this.disposal = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // The process can disappear between checking and signalling it.
        }
        finish();
      }, 3_000);
      const finish = () => {
        clearTimeout(timeout);
        this.finishDisposal = undefined;
        resolve();
      };
      this.finishDisposal = finish;
      try {
        this.child.kill("SIGTERM");
      } catch {
        // Keep the bounded SIGKILL fallback even when the initial signal fails.
      }
    });
  }

  private write(message: JsonRpcMessage): void {
    if (this.closed) return;
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) this.fail("Browser kernel input failed.");
      });
    } catch {
      this.fail("Browser kernel input failed.");
    }
  }
}

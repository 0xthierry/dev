import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";

type JsonObject = Record<string, unknown>;

type PiRpcHarnessOptions = {
  cwd?: string;
  extensionPath?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  noSession?: boolean;
};

type PendingRequest = {
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type PendingEventWaiter = {
  predicate: (event: JsonObject) => boolean;
  resolve: (value: JsonObject) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export type PiRpcHarness = {
  request: (command: JsonObject, timeoutMs?: number) => Promise<JsonObject>;
  waitForEvent: (predicate: (event: JsonObject) => boolean, timeoutMs?: number) => Promise<JsonObject>;
  stop: () => Promise<void>;
  events: JsonObject[];
  stderr: () => string;
};

export async function startPiRpcHarness(options: PiRpcHarnessOptions = {}): Promise<PiRpcHarness> {
  const cwd = options.cwd ?? process.cwd();
  const args = ["--mode", "rpc"];
  if (options.noSession !== false) args.push("--no-session");

  if (options.extensionPath) {
    args.push("-e", resolve(cwd, options.extensionPath));
  }

  args.push(...(options.args ?? []));

  const child = spawn("pi", args, {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: "pipe",
  });

  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  const harness = await createHarness(child, startupTimeoutMs);
  await harness.request({ type: "get_state" }, startupTimeoutMs);
  return harness;
}

function createHarness(child: ChildProcessWithoutNullStreams, startupTimeoutMs: number): Promise<PiRpcHarness> {
  const pendingRequests = new Map<string, PendingRequest>();
  const pendingEventWaiters = new Set<PendingEventWaiter>();
  const events: JsonObject[] = [];
  const stderrChunks: string[] = [];
  let stdoutBuffer = "";
  let requestCounter = 0;
  let settledStartup = false;

  const startup = new Promise<PiRpcHarness>((resolveStartup, rejectStartup) => {
    const startupTimeout = setTimeout(() => {
      if (!settledStartup) {
        settledStartup = true;
        rejectStartup(new Error(`Timed out waiting for Pi RPC startup. stderr:\n${stderrChunks.join("")}`));
        child.kill();
      }
    }, startupTimeoutMs);

    const finishStartup = (harness: PiRpcHarness) => {
      if (settledStartup) return;
      settledStartup = true;
      clearTimeout(startupTimeout);
      resolveStartup(harness);
    };

    const failStartup = (error: Error) => {
      if (settledStartup) return;
      settledStartup = true;
      clearTimeout(startupTimeout);
      rejectStartup(error);
    };

    const harness: PiRpcHarness = {
      events,
      stderr: () => stderrChunks.join(""),

      request(command, timeoutMs = 10_000) {
        const id = String(command.id ?? `req-${++requestCounter}`);
        const payload: JsonObject = { ...command, id };

        return new Promise<JsonObject>((resolve, reject) => {
          const timeout = setTimeout(() => {
            pendingRequests.delete(id);
            reject(
              new Error(
                `Timed out waiting for RPC response to ${payload.type ?? "unknown"}. stderr:\n${stderrChunks.join("")}`,
              ),
            );
          }, timeoutMs);

          pendingRequests.set(id, { resolve, reject, timeout });
          child.stdin.write(`${JSON.stringify(payload)}\n`);
        });
      },

      waitForEvent(predicate, timeoutMs = 30_000) {
        const existing = events.find(predicate);
        if (existing) return Promise.resolve(existing);

        return new Promise<JsonObject>((resolve, reject) => {
          const waiter: PendingEventWaiter = {
            predicate,
            resolve,
            reject,
            timeout: setTimeout(() => {
              pendingEventWaiters.delete(waiter);
              reject(new Error(`Timed out waiting for RPC event. stderr:\n${stderrChunks.join("")}`));
            }, timeoutMs),
          };
          pendingEventWaiters.add(waiter);
        });
      },

      async stop() {
        for (const pending of pendingRequests.values()) {
          clearTimeout(pending.timeout);
          pending.reject(new Error("Pi RPC harness stopped before response arrived"));
        }
        pendingRequests.clear();

        for (const waiter of pendingEventWaiters) {
          clearTimeout(waiter.timeout);
          waiter.reject(new Error("Pi RPC harness stopped before event arrived"));
        }
        pendingEventWaiters.clear();

        if (!child.killed) child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 1_000);
          child.once("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      },
    };

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(String(chunk));
    });

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (!trimmed.trim()) continue;

        let message: JsonObject;
        try {
          message = JSON.parse(trimmed) as JsonObject;
        } catch {
          failStartup(new Error(`Invalid JSON from Pi RPC: ${trimmed}`));
          continue;
        }

        if (message.type === "session") {
          events.push(message);
          finishStartup(harness);
          continue;
        }

        if (message.type === "response" && typeof message.id === "string" && pendingRequests.has(message.id)) {
          const pending = pendingRequests.get(message.id);
          if (!pending) continue;
          pendingRequests.delete(message.id);
          clearTimeout(pending.timeout);
          pending.resolve(message);
          continue;
        }

        events.push(message);
        for (const waiter of [...pendingEventWaiters]) {
          if (!waiter.predicate(message)) continue;
          pendingEventWaiters.delete(waiter);
          clearTimeout(waiter.timeout);
          waiter.resolve(message);
        }
      }
    });

    child.once("error", (error) => {
      failStartup(error);
    });

    child.once("exit", (code, signal) => {
      const error = new Error(
        `Pi RPC process exited with code ${code ?? "null"} and signal ${signal ?? "null"}. stderr:\n${stderrChunks.join("")}`,
      );
      failStartup(error);

      for (const pending of pendingRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(error);
      }
      pendingRequests.clear();

      for (const waiter of pendingEventWaiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(error);
      }
      pendingEventWaiters.clear();
    });

    queueMicrotask(() => finishStartup(harness));
  });

  return startup;
}

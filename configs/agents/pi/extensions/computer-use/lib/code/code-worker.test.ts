import { afterEach, describe, expect, mock, test } from "bun:test";
import { Worker } from "node:worker_threads";

interface WorkerMessage {
  type: string;
  value?: string;
  store?: string;
  error?: string;
}

afterEach(() => {
  mock.clearAllMocks();
});

describe("code-worker TypeScript entrypoint", () => {
  test("loads without a build directory and exposes only explicit emit and JSON store bridges", async () => {
    // Arrange
    const messages: WorkerMessage[] = [];
    let resolveDone: (() => void) | undefined;
    let rejectDone: ((error: Error) => void) | undefined;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const onMessage = mock((message: WorkerMessage) => {
      messages.push(message);
      if (message.type === "done") resolveDone?.();
    });
    const onError = mock((error: Error) => rejectDone?.(error));
    const worker = new Worker(new URL("./code-worker.ts", import.meta.url), {
      workerData: {
        code: `
          store.count += 1;
          let functionEscapeBlocked = false;
          try { Function("return process")(); } catch { functionEscapeBlocked = true; }
          emit({
            count: store.count,
            processType: typeof process,
            requireType: typeof require,
            bunType: typeof Bun,
            functionEscapeBlocked,
          });
        `,
        store: { count: 1 },
      },
    });
    worker.on("message", onMessage);
    worker.once("error", onError);

    // Act
    await done;
    await worker.terminate();

    // Assert
    expect(onError).not.toHaveBeenCalled();
    expect(messages.map((message) => message.type)).toEqual(["ready", "emit", "done"]);
    expect(JSON.parse(messages[1]?.value ?? "null")).toEqual({
      count: 2,
      processType: "undefined",
      requireType: "undefined",
      bunType: "undefined",
      functionEscapeBlocked: true,
    });
    expect(JSON.parse(messages[2]?.store ?? "null")).toEqual({ count: 2 });
  });
});

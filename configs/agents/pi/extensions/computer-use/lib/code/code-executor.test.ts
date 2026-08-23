import { afterEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { DirectMethod, JsonValue } from "../broker/tools";
import { type CodeWorkerHost, ComputerUseCodeExecutor } from "./code-executor";

afterEach(() => {
  mock.clearAllMocks();
});

type SessionExecutor = NonNullable<ConstructorParameters<typeof ComputerUseCodeExecutor>[0]>;
type WorkerData = { code: string; store: Record<string, JsonValue | undefined> };

class TestComputerUseCodeExecutor extends ComputerUseCodeExecutor {
  constructor(
    sessionExecutor: SessionExecutor,
    private readonly workerFactory: (workerData: WorkerData) => CodeWorkerHost,
  ) {
    super(sessionExecutor);
  }

  protected override createWorker(workerData: WorkerData): CodeWorkerHost {
    return this.workerFactory(workerData);
  }
}

describe("ComputerUseCodeExecutor", () => {
  test("runs the local TypeScript worker with persistent JSON store and explicit emits", async () => {
    // Arrange
    const execute = mock(async () => ({ isError: false, content: [] }));
    const close = mock(async () => undefined);
    const executor = new ComputerUseCodeExecutor({ execute, close });

    // Act
    const first = await executor.execute("store.count = (store.count || 0) + 1; emit(store);", {});
    const second = await executor.execute("store.count += 1; emit(store);", {});
    await executor.close();

    // Assert
    expect(first.content).toEqual([{ type: "text", text: '{\n  "count": 1\n}' }]);
    expect(second.content).toEqual([{ type: "text", text: '{\n  "count": 2\n}' }]);
    expect(executor.store).toEqual({ count: 2 });
    expect(execute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("prevents model-authored code from escaping through bridge constructors", async () => {
    // Arrange
    const execute = mock(async () => ({ isError: false, content: [] }));
    const close = mock(async () => undefined);
    const executor = new ComputerUseCodeExecutor({ execute, close });

    // Act
    const result = await executor.execute('emit(sky.click.constructor("return process")());', {});

    // Assert
    expect(result.error).toMatch(/Code generation from strings disallowed/);
    expect(execute).not.toHaveBeenCalled();
  });

  test("dispatches worker calls and preserves emits, call history, and store after failure", async () => {
    // Arrange
    const execute = mock(async (method: DirectMethod) => {
      if (method === "click") {
        return { isError: true, content: [{ type: "text", text: "element not found" }] };
      }
      return { isError: false, content: [{ type: "text", text: "initial state" }] };
    });
    const close = mock(async () => undefined);
    const worker = new EventEmitter() as EventEmitter & CodeWorkerHost;
    worker.terminate = mock(async () => 0);
    worker.postMessage = mock((message: unknown) => {
      const result = message as { id?: number; error?: string; value?: string };
      if (result.id === 1 && result.value) {
        queueMicrotask(() => {
          worker.emit("message", { type: "emit", value: JSON.stringify("initial state") });
          worker.emit("message", {
            type: "call",
            id: 2,
            method: "click",
            args: JSON.stringify({ app: "TextEdit", element_index: "missing" }),
          });
        });
      }
      if (result.id === 2 && result.error) {
        queueMicrotask(() => {
          worker.emit("message", {
            type: "done",
            store: JSON.stringify({ lastState: "initial state" }),
            error: result.error,
          });
        });
      }
    });
    const createWorker = mock((_workerData: WorkerData): CodeWorkerHost => {
      queueMicrotask(() => {
        worker.emit("message", { type: "ready" });
        worker.emit("message", {
          type: "call",
          id: 1,
          method: "get_app_state",
          args: JSON.stringify({ app: "TextEdit" }),
        });
      });
      return worker;
    });
    const executor = new TestComputerUseCodeExecutor({ execute, close }, createWorker);

    // Act
    const result = await executor.execute("model-authored body is isolated in the worker", {});

    // Assert
    expect(createWorker).toHaveBeenCalledWith({
      code: "model-authored body is isolated in the worker",
      store: { lastState: "initial state" },
    });
    expect(execute.mock.calls.map((entry) => entry[0])).toEqual(["get_app_state", "click"]);
    expect(result.error).toBe("element not found");
    expect(result.calls).toEqual(["get_app_state", "click"]);
    expect(result.content).toEqual([
      { type: "text", text: "initial state" },
      { type: "text", text: "Computer Use code stopped: element not found" },
    ]);
    expect(executor.store.lastState).toBe("initial state");
  });

  test("bounds values emitted by model-authored code", async () => {
    // Arrange
    const execute = mock(async () => ({ isError: false, content: [] }));
    const close = mock(async () => undefined);
    const executor = new ComputerUseCodeExecutor({ execute, close });

    // Act
    const result = await executor.execute("for (let index = 0; index < 101; index += 1) emit(index);", {});

    // Assert
    expect(result.error).toContain("exceeded 100 emits");
    expect(result.content).toHaveLength(101);
    expect(result.content.at(-1)?.text).toContain("exceeded 100 emits");
  });

  test("rejects oversized model-authored code before starting a worker", async () => {
    // Arrange
    const execute = mock(async () => ({ isError: false, content: [] }));
    const close = mock(async () => undefined);
    const executor = new ComputerUseCodeExecutor({ execute, close });
    const code = "x".repeat(20_001);

    // Act
    const execution = executor.execute(code, {});

    // Assert
    await expect(execution).rejects.toThrow("exceeds 20000 bytes");
    expect(execute).not.toHaveBeenCalled();
  });
});

import { expect, mock, test } from "bun:test";
import type { BrowserUseKernel } from "./kernel";
import type { BrowserUsePaths } from "./paths";
import { createBrowserUseRuntime } from "./runtime";

const paths: BrowserUsePaths = {
  available: true,
  nodeRepl: "/test/repl",
  node: "/test/node",
  nodeModules: "/test/modules",
  browserClient: "/test/client",
  browserService: "/test/service",
  codexHome: "/test/home",
  codexCli: "/test/codex",
};
const result = { text: "ok", isError: false, content: [{ type: "text" as const, text: "ok" }] };

function fakeKernel(): BrowserUseKernel {
  const kernel = {
    closed: false,
    execute: mock(async () => result),
    endTurn: mock(async () => undefined),
    close: mock(async () => {
      kernel.closed = true;
    }),
  };
  return kernel;
}

test("starts lazily, reuses the kernel across turns, and shuts down idempotently", async () => {
  // Arrange
  const kernel = fakeKernel();
  const create = mock(async () => kernel);
  const runtime = createBrowserUseRuntime(paths, create);

  // Act
  await runtime.endTurn();
  expect(create).not.toHaveBeenCalled();
  await runtime.execute("first");
  await runtime.endTurn();
  await runtime.execute("second");
  await runtime.close();
  await runtime.close();

  // Assert
  expect(create).toHaveBeenCalledTimes(1);
  expect(kernel.execute).toHaveBeenCalledTimes(2);
  expect(kernel.endTurn).toHaveBeenCalledTimes(1);
  expect(kernel.close).toHaveBeenCalledTimes(1);
  await expect(runtime.execute("late")).rejects.toThrow("shut down");
});

test("does not cache rejected startup or replay failed code", async () => {
  // Arrange
  const kernel = fakeKernel();
  const create = mock<() => Promise<BrowserUseKernel>>()
    .mockRejectedValueOnce(new Error("startup failed"))
    .mockResolvedValue(kernel);
  const runtime = createBrowserUseRuntime(paths, create);

  // Act
  await expect(runtime.execute("do not replay")).rejects.toThrow("startup failed");
  await runtime.execute("next call");

  // Assert
  expect(create).toHaveBeenCalledTimes(2);
  expect(kernel.execute).toHaveBeenCalledTimes(1);
  expect(kernel.execute).toHaveBeenCalledWith("next call", undefined);
  await runtime.close();
});

test("replaces a dead kernel on the next call and reports binding loss", async () => {
  // Arrange
  const first = fakeKernel();
  const second = fakeKernel();
  const create = mock<() => Promise<BrowserUseKernel>>().mockResolvedValueOnce(first).mockResolvedValue(second);
  const runtime = createBrowserUseRuntime(paths, create);
  await runtime.execute("first");
  await first.close();

  // Act
  const recovered = await runtime.execute("bootstrap");

  // Assert
  expect(create).toHaveBeenCalledTimes(2);
  expect(first.execute).toHaveBeenCalledTimes(1);
  expect(second.execute).toHaveBeenCalledWith("bootstrap", undefined);
  expect(recovered.text).toContain("bindings were lost");
  await runtime.close();
});

test("does not start a kernel for an already cancelled call", async () => {
  // Arrange
  const create = mock(async () => fakeKernel());
  const runtime = createBrowserUseRuntime(paths, create);
  const controller = new AbortController();
  controller.abort();

  // Act / Assert
  await expect(runtime.execute("cancelled", controller.signal)).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

test("serializes calls and turn cleanup", async () => {
  // Arrange
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const begun = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const kernel = fakeKernel();
  kernel.execute = mock(async () => {
    entered();
    await blocked;
    return result;
  });
  const runtime = createBrowserUseRuntime(paths, async () => kernel);

  // Act
  const first = runtime.execute("first");
  const second = runtime.execute("second");
  const cleanup = runtime.endTurn();
  await begun;

  // Assert
  expect(kernel.execute).toHaveBeenCalledTimes(1);
  expect(kernel.endTurn).not.toHaveBeenCalled();
  release();
  await Promise.all([first, second, cleanup]);
  expect(kernel.execute).toHaveBeenCalledTimes(2);
  expect(kernel.endTurn).toHaveBeenCalledTimes(1);
  await runtime.close();
});

test("shutdown during startup closes the process and rejects queued work", async () => {
  // Arrange
  const kernel = fakeKernel();
  let release!: (kernel: BrowserUseKernel) => void;
  const pending = new Promise<BrowserUseKernel>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const begun = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const create = mock(() => {
    entered();
    return pending;
  });
  const runtime = createBrowserUseRuntime(paths, create);

  // Act
  const execution = runtime.execute("first");
  const rejected = execution.catch((error: unknown) => error);
  await begun;
  const shutdown = runtime.close();
  release(kernel);
  const [error] = await Promise.all([rejected, shutdown]);

  // Assert
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain("shut down");
  expect(kernel.closed).toBe(true);
  expect(kernel.execute).not.toHaveBeenCalled();
});

import type { BrowserUseApprovalHandler } from "./approval";
import { type BrowserUseKernel, createBrowserUseKernel } from "./kernel";
import type { BrowserUsePaths } from "./paths";
import type { BrowserUseExecutionResult } from "./result";

export type BrowserUseRuntime = {
  execute(code: string, signal?: AbortSignal, approve?: BrowserUseApprovalHandler): Promise<BrowserUseExecutionResult>;
  endTurn(): Promise<void>;
  close(): Promise<void>;
};

export function createBrowserUseRuntime(
  paths: BrowserUsePaths,
  createKernel: (paths: BrowserUsePaths, approve: BrowserUseApprovalHandler) => Promise<BrowserUseKernel> = (
    paths,
    approve,
  ) => createBrowserUseKernel(paths, undefined, approve),
): BrowserUseRuntime {
  let kernel: BrowserUseKernel | undefined;
  let starting: Promise<BrowserUseKernel> | undefined;
  let stopped = false;
  let activeApproval: BrowserUseApprovalHandler | undefined;
  const approve: BrowserUseApprovalHandler = (params, signal) =>
    activeApproval ? activeApproval(params, signal) : Promise.resolve({ action: "cancel" });
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }

  async function getKernel(): Promise<BrowserUseKernel> {
    if (stopped) throw new Error("Browser runtime has shut down. Reload the session before using browser_use.");
    if (kernel && !kernel.closed) return kernel;
    const pending = createKernel(paths, approve);
    starting = pending;
    try {
      const created = await pending;
      if (stopped) {
        await created.close();
        throw new Error("Browser runtime shut down during startup.");
      }
      kernel = created;
      return created;
    } finally {
      if (starting === pending) starting = undefined;
    }
  }

  return {
    execute(code, signal, confirmation) {
      return enqueue(async () => {
        signal?.throwIfAborted();
        activeApproval = confirmation;
        try {
          const restarted = kernel?.closed === true;
          const active = await getKernel();
          signal?.throwIfAborted();
          // Never replay failed JavaScript: it may already have changed a page.
          const result = await active.execute(code, signal);
          if (!restarted) return result;
          const text =
            "Browser kernel restarted; previous JavaScript bindings were lost. Bootstrap again before reusing browser handles.";
          return { ...result, text: `${text}\n${result.text}`, content: [{ type: "text", text }, ...result.content] };
        } finally {
          activeApproval = undefined;
        }
      });
    },
    endTurn() {
      return enqueue(async () => {
        if (!stopped && kernel && !kernel.closed) await kernel.endTurn();
      });
    },
    async close() {
      if (stopped) return;
      stopped = true;
      if (kernel) await kernel.close();
      if (starting) {
        try {
          await (await starting).close();
        } catch {
          // Startup reports its own failure to its caller.
        }
      }
    },
  };
}

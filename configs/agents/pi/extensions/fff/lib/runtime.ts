import type { FileFinderApi, InitOptions, Result } from "@ff-labs/fff-node";
import { FileFinder } from "@ff-labs/fff-node";
import type { FffDbPathResolver } from "./db-paths";
import type { FffFinder, FffRuntime } from "./types";

const DEFAULT_SCAN_WAIT_MS = 15_000;

export type FffRuntimeOptions = {
  resolveDbPaths?: FffDbPathResolver;
  enableFsRootScanning: boolean;
  waitForScanMs?: number;
  createFinder?: (options: InitOptions) => Result<FileFinderApi>;
};

export function createFffRuntime(options: FffRuntimeOptions): FffRuntime {
  const createFinder = options.createFinder ?? FileFinder.create;
  const waitForScanMs = options.waitForScanMs ?? DEFAULT_SCAN_WAIT_MS;
  let finder: FffFinder | null = null;
  let finderCwd: string | null = null;
  let finderPromise: Promise<FffFinder> | null = null;

  async function ensureFinder(cwd: string): Promise<FffFinder> {
    if (finder && !finder.isDestroyed && finderCwd === cwd) return finder;
    if (finderPromise) return finderPromise;

    finderPromise = (async () => {
      destroy();

      const dbPaths = options.resolveDbPaths?.(cwd) ?? {};
      const result = createFinder({
        basePath: cwd,
        frecencyDbPath: dbPaths.frecencyDbPath,
        historyDbPath: dbPaths.historyDbPath,
        aiMode: true,
        enableHomeDirScanning: true,
        enableFsRootScanning: options.enableFsRootScanning,
      });

      if (!result.ok) throw new Error(`Failed to create FFF file finder: ${result.error}`);

      finder = result.value;
      finderCwd = cwd;
      const scan = await finder.waitForScan(waitForScanMs);
      if (!scan.ok) throw new Error(`FFF scan failed: ${scan.error}`);

      return finder;
    })().finally(() => {
      finderPromise = null;
    });

    return finderPromise;
  }

  function getFinder(): FffFinder | null {
    return finder && !finder.isDestroyed ? finder : null;
  }

  function destroy(): void {
    if (finder && !finder.isDestroyed) finder.destroy();
    finder = null;
    finderCwd = null;
  }

  return { ensureFinder, getFinder, destroy };
}

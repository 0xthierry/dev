import { describe, expect, mock, test } from "bun:test";
import type { FileFinderApi, InitOptions } from "@ff-labs/fff-node";
import { createFffRuntime } from "./runtime";

describe("createFffRuntime", () => {
  test("creates a finder with AI defaults and waits for scan", async () => {
    // Arrange
    const finder = createFakeFinder();
    const createFinder = mock((_options: InitOptions) => ({ ok: true as const, value: finder }));
    const runtime = createFffRuntime({
      resolveDbPaths: () => ({ frecencyDbPath: "/tmp/frecency", historyDbPath: "/tmp/history" }),
      enableFsRootScanning: true,
      waitForScanMs: 123,
      createFinder,
    });

    // Act
    const result = await runtime.ensureFinder("/tmp/workspace");

    // Assert
    expect(result).toBe(finder);
    expect(createFinder).toHaveBeenCalledWith({
      basePath: "/tmp/workspace",
      frecencyDbPath: "/tmp/frecency",
      historyDbPath: "/tmp/history",
      aiMode: true,
      enableHomeDirScanning: true,
      enableFsRootScanning: true,
    });
    expect(finder.waitForScan).toHaveBeenCalledWith(123);
  });

  test("reuses an existing finder for the same cwd", async () => {
    // Arrange
    const finder = createFakeFinder();
    const createFinder = mock(() => ({ ok: true as const, value: finder }));
    const runtime = createFffRuntime({ enableFsRootScanning: false, createFinder });

    // Act
    const first = await runtime.ensureFinder("/tmp/workspace");
    const second = await runtime.ensureFinder("/tmp/workspace");

    // Assert
    expect(first).toBe(second);
    expect(createFinder).toHaveBeenCalledTimes(1);
  });

  test("destroys the previous finder when cwd changes", async () => {
    // Arrange
    const firstFinder = createFakeFinder();
    const secondFinder = createFakeFinder();
    const createFinder = mock((options: InitOptions) => ({
      ok: true as const,
      value: options.basePath === "/tmp/one" ? firstFinder : secondFinder,
    }));
    const runtime = createFffRuntime({ enableFsRootScanning: false, createFinder });

    // Act
    await runtime.ensureFinder("/tmp/one");
    await runtime.ensureFinder("/tmp/two");

    // Assert
    expect(firstFinder.destroy).toHaveBeenCalledTimes(1);
    expect(runtime.getFinder()).toBe(secondFinder);
  });

  test("shares concurrent finder creation", async () => {
    // Arrange
    const finder = createFakeFinder({ waitMs: 5 });
    const createFinder = mock(() => ({ ok: true as const, value: finder }));
    const runtime = createFffRuntime({ enableFsRootScanning: false, createFinder });

    // Act
    const [first, second] = await Promise.all([
      runtime.ensureFinder("/tmp/workspace"),
      runtime.ensureFinder("/tmp/workspace"),
    ]);

    // Assert
    expect(first).toBe(finder);
    expect(second).toBe(finder);
    expect(createFinder).toHaveBeenCalledTimes(1);
  });
});

function createFakeFinder(options: { waitMs?: number } = {}): FileFinderApi {
  let destroyed = false;
  return {
    get isDestroyed() {
      return destroyed;
    },
    destroy: mock(() => {
      destroyed = true;
    }),
    waitForScan: mock(async () => {
      if (options.waitMs) await new Promise((resolve) => setTimeout(resolve, options.waitMs));
      return { ok: true, value: true };
    }),
    fileSearch: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalFiles: 0 } })),
    glob: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalFiles: 0 } })),
    directorySearch: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalDirs: 0 } })),
    mixedSearch: mock(() => ({
      ok: true,
      value: { items: [], scores: [], totalMatched: 0, totalFiles: 0, totalDirs: 0 },
    })),
    grep: mock(() => ({
      ok: true,
      value: {
        items: [],
        totalMatched: 0,
        totalFilesSearched: 0,
        totalFiles: 0,
        filteredFileCount: 0,
        nextCursor: null,
      },
    })),
    multiGrep: mock(() => ({
      ok: true,
      value: {
        items: [],
        totalMatched: 0,
        totalFilesSearched: 0,
        totalFiles: 0,
        filteredFileCount: 0,
        nextCursor: null,
      },
    })),
    scanFiles: mock(() => ({ ok: true, value: undefined })),
    isScanning: mock(() => false),
    getBasePath: mock(() => ({ ok: true, value: "/tmp/workspace" })),
    getScanProgress: mock(() => ({
      ok: true,
      value: { scannedFilesCount: 1, isScanning: false, isWatcherReady: true, isWarmupComplete: true },
    })),
    waitForScanBlocking: mock(() => ({ ok: true, value: true })),
    waitForIndexReady: mock(async () => ({ ok: true, value: true })),
    reindex: mock(() => ({ ok: true, value: undefined })),
    refreshGitStatus: mock(() => ({ ok: true, value: 0 })),
    trackQuery: mock(() => ({ ok: true, value: true })),
    getHistoricalQuery: mock(() => ({ ok: true, value: null })),
    healthCheck: mock(() => ({
      ok: true,
      value: {
        version: "test",
        git: { available: true, repositoryFound: false, libGit2Version: "test" } as never,
        filePicker: { initialized: true, indexedFiles: 1 },
        frecency: { initialized: false },
        queryTracker: { initialized: false },
      },
    })),
  } as unknown as FileFinderApi;
}

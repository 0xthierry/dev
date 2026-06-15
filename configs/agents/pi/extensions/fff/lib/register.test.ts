import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { readRuntimeOptions, registerFff, registerFffExtension } from "./register";
import type { FffFinder, FffRuntime } from "./types";

const originalFrecencyDb = process.env.FFF_FRECENCY_DB;
const originalHistoryDb = process.env.FFF_HISTORY_DB;
const originalRootScan = process.env.FFF_ENABLE_ROOT_SCAN;

afterEach(() => {
  restoreEnv("FFF_FRECENCY_DB", originalFrecencyDb);
  restoreEnv("FFF_HISTORY_DB", originalHistoryDb);
  restoreEnv("FFF_ENABLE_ROOT_SCAN", originalRootScan);
});

describe("registerFffExtension", () => {
  test("registers flags, tools, commands, and lifecycle handlers", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerFffExtension(fakePi.pi);

    // Assert
    expect(fakePi.registeredFlags.has("fff-frecency-db")).toBe(true);
    expect(fakePi.registeredFlags.has("fff-history-db")).toBe(true);
    expect(fakePi.registeredFlags.has("fff-enable-root-scan")).toBe(true);
    expect([...fakePi.tools.keys()]).toEqual(["grep", "find", "multi_grep"]);
    expect(fakePi.commands.has("fff-health")).toBe(true);
    expect(fakePi.commands.has("fff-rescan")).toBe(true);
    expect(fakePi.handlers.has("session_start")).toBe(true);
    expect(fakePi.handlers.has("session_shutdown")).toBe(true);
  });
});

describe("registerFff", () => {
  test("initializes FFF and registers autocomplete on session start", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const runtime = createRuntime(createFinder());
    registerFff(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", { reason: "startup" }, { cwd: "/tmp/workspace", hasUI: true });

    // Assert
    expect(runtime.ensureFinder).toHaveBeenCalledWith("/tmp/workspace");
    expect(fakePi.autocompleteProviderFactories).toHaveLength(1);
  });

  test("destroys runtime on shutdown", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime(createFinder());
    registerFff(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_shutdown");

    // Assert
    expect(runtime.destroy).toHaveBeenCalledTimes(1);
  });

  test("reports init errors through UI", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const runtime: FffRuntime = {
      ensureFinder: mock(async () => {
        throw new Error("native load failed");
      }),
      getFinder: mock(() => null),
      destroy: mock(() => undefined),
    };
    registerFff(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", { reason: "startup" }, { cwd: "/tmp/workspace", hasUI: true });

    // Assert
    expect(fakePi.uiNotifications[0]?.message).toContain("FFF init failed: native load failed");
    expect(fakePi.uiNotifications[0]?.type).toBe("error");
  });
});

describe("readRuntimeOptions", () => {
  test("prefers flags over environment", () => {
    // Arrange
    process.env.FFF_FRECENCY_DB = "/env/frecency";
    process.env.FFF_HISTORY_DB = "/env/history";
    process.env.FFF_ENABLE_ROOT_SCAN = "0";
    const fakePi = createFakePi({
      flags: {
        "fff-frecency-db": "/flag/frecency",
        "fff-history-db": "/flag/history",
        "fff-enable-root-scan": true,
      },
    });

    // Act
    const options = readRuntimeOptions(fakePi.pi);

    // Assert
    expect(options).toMatchObject({
      frecencyDbPath: "/flag/frecency",
      historyDbPath: "/flag/history",
      enableFsRootScanning: true,
    });
  });
});

function createRuntime(finder: FffFinder): FffRuntime {
  return {
    ensureFinder: mock(async () => finder),
    getFinder: mock(() => finder),
    destroy: mock(() => undefined),
  };
}

function createFinder(): FffFinder {
  return {
    get isDestroyed() {
      return false;
    },
    destroy: mock(() => undefined),
    mixedSearch: mock(() => ({
      ok: true,
      value: { items: [], scores: [], totalMatched: 0, totalFiles: 0, totalDirs: 0 },
    })),
    waitForScan: mock(async () => ({ ok: true, value: true })),
    fileSearch: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalFiles: 0 } })),
    glob: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalFiles: 0 } })),
    directorySearch: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalDirs: 0 } })),
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
      value: { scannedFilesCount: 0, isScanning: false, isWatcherReady: true, isWarmupComplete: true },
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
        git: { available: true, repositoryFound: false, libgit2Version: "1" },
        filePicker: { initialized: true, indexedFiles: 0 },
        frecency: { initialized: false },
        queryTracker: { initialized: false },
      },
    })),
  } as unknown as FffFinder;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

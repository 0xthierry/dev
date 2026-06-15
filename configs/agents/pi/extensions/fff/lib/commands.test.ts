import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { formatHealthMessage, registerFffCommands } from "./commands";
import type { FffFinder, FffRuntime, HealthCheck } from "./types";

describe("registerFffCommands", () => {
  test("registers health and rescan commands", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime(createFinder());

    // Act
    registerFffCommands(fakePi.pi, runtime, () => "/tmp/workspace");

    // Assert
    expect(fakePi.commands.has("fff-health")).toBe(true);
    expect(fakePi.commands.has("fff-rescan")).toBe(true);
  });

  test("fff-health reports finder health through UI", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder();
    const runtime = createRuntime(finder);
    registerFffCommands(fakePi.pi, runtime, () => "/tmp/workspace");

    // Act
    await fakePi.runCommand("fff-health", "", { hasUI: true });

    // Assert
    expect(fakePi.uiNotifications).toHaveLength(1);
    expect(fakePi.uiNotifications[0]?.message).toContain("FFF vtest");
    expect(finder.healthCheck).toHaveBeenCalledTimes(1);
  });

  test("fff-rescan triggers scanFiles", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder();
    const runtime = createRuntime(finder);
    registerFffCommands(fakePi.pi, runtime, () => "/tmp/workspace");

    // Act
    await fakePi.runCommand("fff-rescan", "", { hasUI: true });

    // Assert
    expect(finder.scanFiles).toHaveBeenCalledTimes(1);
    expect(fakePi.uiNotifications[0]?.message).toBe("FFF rescan triggered");
  });

  test("sends a custom message without UI", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const runtime = createRuntime(createFinder());
    registerFffCommands(fakePi.pi, runtime, () => "/tmp/workspace");

    // Act
    await fakePi.runCommand("fff-health", "", { hasUI: false });

    // Assert
    expect(fakePi.sentMessages).toHaveLength(1);
    expect(JSON.stringify(fakePi.sentMessages[0]?.message)).toContain("FFF vtest");
  });
});

describe("formatHealthMessage", () => {
  test("formats health and progress", () => {
    // Arrange
    const health = createHealth();
    const progress = { scannedFilesCount: 3, isScanning: false, isWatcherReady: true, isWarmupComplete: true };

    // Act
    const result = formatHealthMessage(health, progress);

    // Assert
    expect(result).toContain("Tools: overriding grep, find, and multi_grep");
    expect(result).toContain("Picker: 7 files");
    expect(result).toContain("Scanning: no (3 files)");
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
    healthCheck: mock(() => ({ ok: true, value: createHealth() })),
    getScanProgress: mock(() => ({
      ok: true,
      value: { scannedFilesCount: 7, isScanning: false, isWatcherReady: true, isWarmupComplete: true },
    })),
    scanFiles: mock(() => ({ ok: true, value: undefined })),
    waitForScan: mock(async () => ({ ok: true, value: true })),
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
    isScanning: mock(() => false),
    getBasePath: mock(() => ({ ok: true, value: "/tmp/workspace" })),
    waitForScanBlocking: mock(() => ({ ok: true, value: true })),
    waitForIndexReady: mock(async () => ({ ok: true, value: true })),
    reindex: mock(() => ({ ok: true, value: undefined })),
    refreshGitStatus: mock(() => ({ ok: true, value: 0 })),
    trackQuery: mock(() => ({ ok: true, value: true })),
    getHistoricalQuery: mock(() => ({ ok: true, value: null })),
  } as unknown as FffFinder;
}

function createHealth(): HealthCheck {
  return {
    version: "test",
    git: { available: true, repositoryFound: true, workdir: "/tmp/workspace", libgit2Version: "1" },
    filePicker: { initialized: true, indexedFiles: 7 },
    frecency: { initialized: true },
    queryTracker: { initialized: false },
  };
}

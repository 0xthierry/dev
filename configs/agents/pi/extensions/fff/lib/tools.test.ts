import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { createCursorStore } from "./pagination";
import { detectGrepMode, isWildcardOnlyPattern, registerFffTools } from "./tools";
import type { FffFinder, FffRuntime, GrepResult, SearchResult } from "./types";

describe("grep pattern classification", () => {
  test("detects regex only when syntax is valid", () => {
    // Arrange
    const patterns = ["needle", "foo.*bar", "["];

    // Act
    const results = patterns.map(detectGrepMode);

    // Assert
    expect(results).toEqual(["plain", "regex", "plain"]);
  });

  test("rejects wildcard-only patterns", () => {
    // Arrange
    const patterns = [".*", "needle.*", "needle"];

    // Act
    const results = patterns.map(isWildcardOnlyPattern);

    // Assert
    expect(results).toEqual([true, false, false]);
  });
});

describe("registerFffTools", () => {
  test("overrides grep, find, and multi_grep", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime(createFinder());

    // Act
    registerFffTools(fakePi.pi, runtime, createCursorStore(), () => "/tmp/workspace");

    // Assert
    expect([...fakePi.tools.keys()]).toEqual(["grep", "find", "multi_grep"]);
  });

  test("grep builds a constrained query and formats matches", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder({
      grepResult: {
        items: [grepMatch({ relativePath: "src/a.ts", lineNumber: 3, lineContent: "const needle = true;" })],
        totalMatched: 1,
        totalFilesSearched: 1,
        totalFiles: 2,
        filteredFileCount: 1,
        nextCursor: null,
      },
    });
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("grep", { pattern: "needle", path: "src", exclude: "test", limit: 5 });

    // Assert
    expect(finder.grep).toHaveBeenCalledWith(
      "src/ !test/ needle",
      expect.objectContaining({ mode: "plain", pageSize: 5, smartCase: true }),
    );
    expect(JSON.stringify(result)).toContain("src/a.ts");
    expect(JSON.stringify(result)).toContain("const needle = true");
  });

  test("grep falls back to fuzzy when plain search is empty", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const exact: GrepResult = {
      items: [],
      totalMatched: 0,
      totalFilesSearched: 1,
      totalFiles: 1,
      filteredFileCount: 1,
      nextCursor: null,
    };
    const fuzzy: GrepResult = {
      items: [grepMatch({ relativePath: "src/schema.ts", lineContent: "schema" })],
      totalMatched: 1,
      totalFilesSearched: 1,
      totalFiles: 1,
      filteredFileCount: 1,
      nextCursor: null,
    };
    const finder = createFinder();
    finder.grep = mock((_query: string, options?: { mode?: string }) => ({
      ok: true as const,
      value: options?.mode === "fuzzy" ? fuzzy : exact,
    }));
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("grep", { pattern: "schmea" });

    // Assert
    expect(finder.grep).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).toContain("Maybe you meant this");
  });

  test("find stores a pagination cursor when more matches are available", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder({
      fileSearchResult: searchResult(["src/a.ts", "src/b.ts"], 10),
    });
    const cursors = createCursorStore();
    registerFffTools(fakePi.pi, createRuntime(finder), cursors, () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("find", { pattern: "src", limit: 2 });

    // Assert
    expect(finder.fileSearch).toHaveBeenCalledWith("src", { pageIndex: 0, pageSize: 2 });
    expect(JSON.stringify(result)).toContain("fff_f1");
  });

  test("find cursor resumes with stored query and page size", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder({ fileSearchResult: searchResult(["src/c.ts"], 3) });
    const cursors = createCursorStore();
    const cursor = cursors.storeFind({ query: "src", pattern: "src", pageSize: 2, nextPageIndex: 1 });
    registerFffTools(fakePi.pi, createRuntime(finder), cursors, () => "/tmp/workspace");

    // Act
    await fakePi.runTool("find", { pattern: "ignored", cursor });

    // Assert
    expect(finder.fileSearch).toHaveBeenCalledWith("src", { pageIndex: 1, pageSize: 2 });
  });

  test("find hints at AND semantics when a multi-word query returns nothing", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder({ fileSearchResult: searchResult([], 0) });
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("find", { pattern: "nvim tmux ghostty" });

    // Assert
    expect(JSON.stringify(result)).toContain("AND-combined");
  });

  test("find does not hint when a single-word query returns nothing", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder({ fileSearchResult: searchResult([], 0) });
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("find", { pattern: "nvim" });

    // Assert
    expect(JSON.stringify(result)).not.toContain("AND-combined");
  });

  test("multi_grep hints at AND semantics when multiple positive constraints return nothing", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder();
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("multi_grep", {
      patterns: ["clipboard"],
      constraints: "configs/** install/** *.sh",
    });

    // Assert
    expect(JSON.stringify(result)).toContain("AND-combined");
  });

  test("multi_grep does not hint for a single brace-glob constraint", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder();
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    const result = await fakePi.runTool("multi_grep", {
      patterns: ["clipboard"],
      constraints: "{configs,install}/**",
    });

    // Assert
    expect(JSON.stringify(result)).not.toContain("AND-combined");
  });

  test("multi_grep passes patterns and constraints to FFF", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/workspace" });
    const finder = createFinder();
    registerFffTools(fakePi.pi, createRuntime(finder), createCursorStore(), () => "/tmp/workspace");

    // Act
    await fakePi.runTool("multi_grep", { patterns: ["Foo", "foo"], constraints: "*.ts", limit: 4 });

    // Assert
    expect(finder.multiGrep).toHaveBeenCalledWith(
      expect.objectContaining({ patterns: ["Foo", "foo"], constraints: "*.ts", pageSize: 4 }),
    );
  });
});

function createRuntime(finder: FffFinder): FffRuntime {
  return {
    ensureFinder: mock(async () => finder),
    getFinder: mock(() => finder),
    destroy: mock(() => undefined),
  };
}

function createFinder(options: { grepResult?: GrepResult; fileSearchResult?: SearchResult } = {}): FffFinder {
  return {
    get isDestroyed() {
      return false;
    },
    destroy: mock(() => undefined),
    grep: mock(() => ({ ok: true, value: options.grepResult ?? emptyGrepResult() })),
    multiGrep: mock(() => ({ ok: true, value: options.grepResult ?? emptyGrepResult() })),
    fileSearch: mock(() => ({ ok: true, value: options.fileSearchResult ?? searchResult([], 0) })),
    mixedSearch: mock(() => ({
      ok: true,
      value: { items: [], scores: [], totalMatched: 0, totalFiles: 0, totalDirs: 0 },
    })),
    glob: mock(() => ({ ok: true, value: searchResult([], 0) })),
    directorySearch: mock(() => ({ ok: true, value: { items: [], scores: [], totalMatched: 0, totalDirs: 0 } })),
    scanFiles: mock(() => ({ ok: true, value: undefined })),
    isScanning: mock(() => false),
    getBasePath: mock(() => ({ ok: true, value: "/tmp/workspace" })),
    getScanProgress: mock(() => ({
      ok: true,
      value: { scannedFilesCount: 0, isScanning: false, isWatcherReady: true, isWarmupComplete: true },
    })),
    waitForScan: mock(async () => ({ ok: true, value: true })),
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

function emptyGrepResult(): GrepResult {
  return { items: [], totalMatched: 0, totalFilesSearched: 0, totalFiles: 0, filteredFileCount: 0, nextCursor: null };
}

function grepMatch(overrides: Partial<GrepResult["items"][number]> = {}): GrepResult["items"][number] {
  return {
    relativePath: "src/a.ts",
    fileName: "a.ts",
    gitStatus: "clean",
    size: 1,
    modified: 1,
    isBinary: false,
    totalFrecencyScore: 0,
    accessFrecencyScore: 0,
    modificationFrecencyScore: 0,
    lineNumber: 1,
    col: 0,
    byteOffset: 0,
    lineContent: "needle",
    matchRanges: [[0, 6]],
    ...overrides,
  };
}

function searchResult(paths: string[], totalMatched: number): SearchResult {
  return {
    items: paths.map((relativePath) => ({
      relativePath,
      fileName: relativePath.split("/").pop() ?? relativePath,
      size: 1,
      modified: 1,
      accessFrecencyScore: 0,
      modificationFrecencyScore: 0,
      totalFrecencyScore: 0,
      gitStatus: "clean",
    })),
    scores: paths.map(() => ({
      total: 100,
      baseScore: 100,
      filenameBonus: 0,
      specialFilenameBonus: 0,
      frecencyBoost: 0,
      distancePenalty: 0,
      currentFilePenalty: 0,
      comboMatchBoost: 0,
      exactMatch: false,
      matchType: "test",
    })),
    totalMatched,
    totalFiles: totalMatched,
  };
}

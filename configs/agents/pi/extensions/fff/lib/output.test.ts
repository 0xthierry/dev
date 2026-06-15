import { describe, expect, test } from "bun:test";
import { fffFileAnnotation, formatFindOutput, formatGrepOutput } from "./output";
import type { GrepResult, SearchResult } from "./types";

describe("fffFileAnnotation", () => {
  test("prefers git status over frecency", () => {
    // Arrange
    const item = { gitStatus: "modified", totalFrecencyScore: 100 };

    // Act
    const result = fffFileAnnotation(item);

    // Assert
    expect(result).toBe("  [modified in git]");
  });

  test("renders frecency annotations for hot files", () => {
    // Arrange
    const item = { gitStatus: "clean", totalFrecencyScore: 25 };

    // Act
    const result = fffFileAnnotation(item);

    // Assert
    expect(result).toBe("  [VERY often touched file]");
  });
});

describe("formatGrepOutput", () => {
  test("groups matches by file and preserves match order", () => {
    // Arrange
    const result: GrepResult = {
      items: [
        grepMatch({ relativePath: "src/a.ts", lineNumber: 2, lineContent: "  const needle = 1;" }),
        grepMatch({ relativePath: "src/a.ts", lineNumber: 5, lineContent: "  needle();" }),
        grepMatch({ relativePath: "src/b.ts", lineNumber: 1, lineContent: "needle" }),
      ],
      totalMatched: 3,
      totalFilesSearched: 2,
      totalFiles: 10,
      filteredFileCount: 10,
      nextCursor: null,
    };

    // Act
    const output = formatGrepOutput(result);

    // Assert
    expect(output).toBe("src/a.ts\n 2: const needle = 1;\n 5: needle();\n\nsrc/b.ts\n 1: needle");
  });

  test("includes context lines", () => {
    // Arrange
    const result: GrepResult = {
      items: [
        grepMatch({
          relativePath: "src/a.ts",
          lineNumber: 10,
          lineContent: "needle",
          contextBefore: ["before"],
          contextAfter: ["after"],
        }),
      ],
      totalMatched: 1,
      totalFilesSearched: 1,
      totalFiles: 1,
      filteredFileCount: 1,
      nextCursor: null,
    };

    // Act
    const output = formatGrepOutput(result);

    // Assert
    expect(output).toBe("src/a.ts\n 9- before\n 10: needle\n 11- after");
  });
});

describe("formatFindOutput", () => {
  test("caps weak fuzzy noise", () => {
    // Arrange
    const result: SearchResult = {
      items: Array.from({ length: 10 }, (_, index) => ({
        relativePath: `src/file-${index}.ts`,
        fileName: `file-${index}.ts`,
        size: 1,
        modified: 1,
        accessFrecencyScore: 0,
        modificationFrecencyScore: 0,
        totalFrecencyScore: 0,
        gitStatus: "clean",
      })),
      scores: [{ total: 1 } as SearchResult["scores"][number]],
      totalMatched: 10,
      totalFiles: 10,
    };

    // Act
    const formatted = formatFindOutput(result, 10, "needle");

    // Assert
    expect(formatted.weak).toBe(true);
    expect(formatted.shownCount).toBe(5);
    expect(formatted.output.split("\n")).toHaveLength(5);
  });
});

function grepMatch(overrides: Partial<GrepResult["items"][number]>): GrepResult["items"][number] {
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

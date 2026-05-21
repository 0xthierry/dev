import { describe, expect, test } from "bun:test";
import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits, positionAt } from "./text-edits";
import type { LspTextEdit } from "./types";

describe("positionAt", () => {
  test("converts offsets to LSP positions", () => {
    // Arrange
    const text = "one\ntwo\nthree";

    // Act
    const position = positionAt(text, 6);

    // Assert
    expect(position).toEqual({ line: 1, character: 2 });
  });
});

describe("applyTextEdits", () => {
  test("applies edits from the end of the document", () => {
    // Arrange
    const text = "alpha\nbeta\n";
    const edits: LspTextEdit[] = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, newText: "ALPHA" },
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: "BETA" },
    ];

    // Act
    const result = applyTextEdits(text, edits);

    // Assert
    expect(result).toBe("ALPHA\nBETA\n");
  });
});

describe("hasOverlappingTextEdits", () => {
  test("allows multiple insertions at the same position but rejects overlapping replacements", () => {
    // Arrange
    const text = "abcdef";
    const insertions: LspTextEdit[] = [
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: "1" },
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: "2" },
    ];
    const replacements: LspTextEdit[] = [
      { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, newText: "x" },
      { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, newText: "y" },
    ];

    // Act
    const insertionConflict = hasOverlappingTextEdits(text, insertions);
    const replacementConflict = hasOverlappingTextEdits(text, replacements);

    // Assert
    expect(insertionConflict).toBe(false);
    expect(replacementConflict).toBe(true);
  });
});

describe("collectWorkspaceEdits", () => {
  test("collects edits for the requested URI", () => {
    // Arrange
    const uri = "file:///repo/main.ts";
    const edit: LspTextEdit = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      newText: "// fixed\n",
    };

    // Act
    const edits = collectWorkspaceEdits({ documentChanges: [{ textDocument: { uri }, edits: [edit] }] }, uri);

    // Assert
    expect(edits).toEqual([edit]);
  });
});

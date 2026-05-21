import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LspSession, LspSessionFactory } from "./lsp-client";
import { runDiagnostics, runFix, selectCodeActions, textResult } from "./runner";
import type { CodeAction, LspDiagnostic, LspServerAdapter } from "./types";

describe("runDiagnostics", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    mock.clearAllMocks();
  });

  test("opens supported files and formats diagnostics", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-runner-"));
    const filePath = join(tempDir, "main.ts");
    await writeFile(filePath, "const value: string = 1;\n", "utf8");
    const diagnostic: LspDiagnostic = {
      range: { start: { line: 0, character: 22 }, end: { line: 0, character: 23 } },
      severity: 1,
      source: "fake",
      code: "E1",
      message: "Type mismatch",
    };
    const session = fakeSession({ diagnostics: [diagnostic] });
    const factory: LspSessionFactory = { create: mock(() => session) };
    const setStatus = mock(() => undefined);

    // Act
    const result = await runDiagnostics(
      fakeAdapter(),
      { root: tempDir, files: [filePath] },
      1000,
      undefined,
      { ui: { setStatus } },
      "test-lsp",
      factory,
    );

    // Assert
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(session.didOpen).toHaveBeenCalledWith(
      expect.stringContaining("main.ts"),
      "const value: string = 1;\n",
      "typescript",
    );
    expect(result.content[0]?.text).toContain("main.ts:1:23: error fake E1: Type mismatch");
    expect(result.details).toMatchObject({ summary: { files: 1, diagnostics: 1 } });
    expect(setStatus).toHaveBeenCalledWith("test-lsp", "fake diagnostics");
    expect(setStatus).toHaveBeenCalledWith("test-lsp", undefined);
  });
});

describe("runFix", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    mock.clearAllMocks();
  });

  test("previews code-action edits without writing", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-runner-"));
    const filePath = join(tempDir, "main.ts");
    await writeFile(filePath, "let value = 1;\n", "utf8");
    const action = replaceFirstLineAction(pathToFileURL(filePath).href, "const value = 1;\n");
    const session = fakeSession({ actions: [action] });
    const factory: LspSessionFactory = { create: mock(() => session) };

    // Act
    const result = await runFix(
      fakeAdapter(),
      { root: tempDir, path: "main.ts", write: false },
      1000,
      undefined,
      { ui: { setStatus: mock(() => undefined) } },
      "test-lsp",
      factory,
    );
    const fileText = await readFile(join(tempDir, "main.ts"), "utf8");

    // Assert
    expect(fileText).toBe("let value = 1;\n");
    expect(result.content[0]?.text).toContain("fake LSP fix computed changes for main.ts");
    expect(result.content[0]?.text).toContain("const value = 1;");
    expect(result.details).toMatchObject({ changed: true, write: false, kind: "source.fixAll" });
  });

  test("writes code-action edits when requested", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-runner-"));
    const filePath = join(tempDir, "main.ts");
    await writeFile(filePath, "let value = 1;\n", "utf8");
    const action = replaceFirstLineAction(pathToFileURL(filePath).href, "const value = 1;\n");
    const session = fakeSession({ actions: [action] });
    const factory: LspSessionFactory = { create: mock(() => session) };

    // Act
    const result = await runFix(
      fakeAdapter(),
      { root: tempDir, path: "main.ts", write: true },
      1000,
      undefined,
      { ui: { setStatus: mock(() => undefined) } },
      "test-lsp",
      factory,
    );
    const fileText = await readFile(join(tempDir, "main.ts"), "utf8");

    // Assert
    expect(fileText).toBe("const value = 1;\n");
    expect(result.content[0]?.text).toBe("fake LSP fix updated main.ts.");
    expect(result.details).toMatchObject({ changed: true, write: true });
  });
});

describe("selectCodeActions", () => {
  test("selects exact and nested action kinds", () => {
    // Arrange
    const actions: CodeAction[] = [
      { title: "fix all", kind: "source.fixAll" },
      { title: "eslint", kind: "source.fixAll.eslint" },
      { title: "organize", kind: "source.organizeImports" },
    ];

    // Act
    const selected = selectCodeActions(actions, "source.fixAll");

    // Assert
    expect(selected.map((action) => action.title)).toEqual(["fix all", "eslint"]);
  });
});

describe("textResult", () => {
  test("truncates large tool output and records the full output path", () => {
    // Arrange
    const text = Array.from({ length: 2100 }, (_value, index) => `line ${index}`).join("\n");

    // Act
    const result = textResult(text, { kind: "diagnostics" });

    // Assert
    expect(result.content[0]?.text).toContain("Output truncated");
    expect(result.details).toMatchObject({ kind: "diagnostics", fullOutputPath: expect.any(String) });
  });
});

function fakeAdapter(): LspServerAdapter {
  return {
    name: "fake",
    defaultCommand: { command: "fake-lsp", args: [] },
    commandEnvVar: "PI_FAKE_LSP_COMMAND",
    missingCommandHint: "Install fake-lsp.",
    extensions: [".ts"],
    fileNames: [],
    skipDirectories: new Set(),
    isSupportedFile: (filePath) => filePath.endsWith(".ts"),
    languageIdFor: () => "typescript",
  };
}

function fakeSession(options: { diagnostics?: LspDiagnostic[]; actions?: CodeAction[] }): LspSession {
  return {
    start: mock(async () => undefined),
    initialize: mock(async () => undefined),
    didOpen: mock(() => undefined),
    didClose: mock(() => true),
    diagnostics: mock(async () => options.diagnostics ?? []),
    codeActions: mock(async () => options.actions ?? []),
    resolveActions: mock(async (actions: CodeAction[]) => actions),
    shutdown: mock(async () => undefined),
    close: mock(() => undefined),
  };
}

function replaceFirstLineAction(uri: string, newText: string): CodeAction {
  return {
    title: "fix first line",
    kind: "source.fixAll.fake",
    edit: {
      documentChanges: [
        {
          textDocument: { uri },
          edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }, newText }],
        },
      ],
    },
  };
}

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type ExternalEditorSpawnResult = {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
};

export interface ExternalEditorOperations {
  getEditorCommand(): string | undefined;
  createTempDirectory(prefix: string): string;
  writeFile(path: string, content: string): void;
  readFile(path: string): string;
  removeDirectory(path: string): void;
  spawnEditor(commandLine: string): ExternalEditorSpawnResult;
  platform(): NodeJS.Platform;
}

export function editWithExternalEditor(
  initialText: string,
  operations: ExternalEditorOperations = nodeExternalEditorOperations,
): string {
  const editorCommand = operations.getEditorCommand();
  if (!editorCommand) {
    throw new Error("No editor configured. Set $VISUAL or $EDITOR environment variable.");
  }

  const tempDirectory = operations.createTempDirectory(join(tmpdir(), "pi-comment-"));
  const tempFile = join(tempDirectory, "comment.md");

  try {
    operations.writeFile(tempFile, initialText);
    const commandLine = buildEditorCommandLine(editorCommand, tempFile, operations.platform());
    const result = operations.spawnEditor(commandLine);

    if (result.error) throw result.error;
    if (result.signal) throw new Error(`Editor exited after signal ${result.signal}`);
    if (result.status !== 0) throw new Error(`Editor exited with status ${result.status ?? "unknown"}`);

    return operations.readFile(tempFile).replace(/\n$/, "");
  } finally {
    operations.removeDirectory(tempDirectory);
  }
}

export function buildEditorCommandLine(editorCommand: string, filePath: string, platform: NodeJS.Platform): string {
  return `${editorCommand} ${quoteShellArgument(filePath, platform)}`;
}

function quoteShellArgument(value: string, platform: NodeJS.Platform): string {
  if (platform === "win32") return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

const nodeExternalEditorOperations: ExternalEditorOperations = {
  getEditorCommand: () => process.env.VISUAL || process.env.EDITOR,
  createTempDirectory: (prefix) => mkdtempSync(prefix),
  writeFile: (path, content) => writeFileSync(path, content, "utf8"),
  readFile: (path) => readFileSync(path, "utf8"),
  removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
  spawnEditor: (commandLine) => {
    const result = spawnSync(commandLine, { stdio: "inherit", shell: true });
    return { status: result.status, signal: result.signal, error: result.error };
  },
  platform: () => process.platform,
};

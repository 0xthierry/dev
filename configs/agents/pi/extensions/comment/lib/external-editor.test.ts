import { describe, expect, mock, test } from "bun:test";
import { buildEditorCommandLine, type ExternalEditorOperations, editWithExternalEditor } from "./external-editor";

type FakeOperationsConfig = {
  editorCommand: string | undefined;
  editedText?: string;
  spawnResult?: { status: number | null; signal?: NodeJS.Signals | null; error?: Error };
};

type FakeOperations = ExternalEditorOperations & {
  files: Map<string, string>;
};

const tempDirectory = "/tmp/pi-comment-test";
const tempFile = `${tempDirectory}/comment.md`;

describe("editWithExternalEditor", () => {
  test("opens a temporary Markdown file with the configured editor and returns edited text", () => {
    // Arrange
    const operations = createFakeOperations({ editorCommand: "code --wait", editedText: "edited text" });

    // Act
    const result = editWithExternalEditor("initial text", operations);

    // Assert
    expect(result).toBe("edited text");
    expect(operations.createTempDirectory).toHaveBeenCalledWith(expect.stringContaining("pi-comment-"));
    expect(operations.writeFile).toHaveBeenCalledWith(tempFile, "initial text");
    expect(operations.spawnEditor).toHaveBeenCalledWith("code --wait '/tmp/pi-comment-test/comment.md'");
    expect(operations.readFile).toHaveBeenCalledWith(tempFile);
    expect(operations.removeDirectory).toHaveBeenCalledWith(tempDirectory);
  });

  test("removes one trailing newline from the edited text", () => {
    // Arrange
    const operations = createFakeOperations({ editorCommand: "nvim", editedText: "edited text\n" });

    // Act
    const result = editWithExternalEditor("initial text", operations);

    // Assert
    expect(result).toBe("edited text");
  });

  test("fails before creating a temp file when no editor is configured", () => {
    // Arrange
    const operations = createFakeOperations({ editorCommand: undefined });

    // Act
    const action = () => editWithExternalEditor("initial text", operations);

    // Assert
    expect(action).toThrow("No editor configured. Set $VISUAL or $EDITOR environment variable.");
    expect(operations.createTempDirectory).not.toHaveBeenCalled();
  });

  test("cleans up the temp directory when the editor exits with an error", () => {
    // Arrange
    const operations = createFakeOperations({ editorCommand: "false", spawnResult: { status: 1 } });

    // Act
    const action = () => editWithExternalEditor("initial text", operations);

    // Assert
    expect(action).toThrow("Editor exited with status 1");
    expect(operations.removeDirectory).toHaveBeenCalledWith(tempDirectory);
    expect(operations.readFile).not.toHaveBeenCalled();
  });

  test("reports editor process errors", () => {
    // Arrange
    const operations = createFakeOperations({
      editorCommand: "missing-editor",
      spawnResult: { status: null, error: new Error("spawn missing-editor ENOENT") },
    });

    // Act
    const action = () => editWithExternalEditor("initial text", operations);

    // Assert
    expect(action).toThrow("spawn missing-editor ENOENT");
    expect(operations.removeDirectory).toHaveBeenCalledWith(tempDirectory);
  });
});

describe("buildEditorCommandLine", () => {
  test("quotes POSIX file paths safely", () => {
    // Arrange
    const editorCommand = "code --wait";
    const filePath = "/tmp/pi comment/it's.md";

    // Act
    const result = buildEditorCommandLine(editorCommand, filePath, "linux");

    // Assert
    expect(result).toBe("code --wait '/tmp/pi comment/it'\\''s.md'");
  });
});

function createFakeOperations(config: FakeOperationsConfig): FakeOperations {
  const files = new Map<string, string>();

  return {
    files,
    getEditorCommand: mock(() => config.editorCommand),
    createTempDirectory: mock(() => tempDirectory),
    writeFile: mock((path: string, content: string) => {
      files.set(path, content);
    }),
    readFile: mock((path: string) => files.get(path) ?? ""),
    removeDirectory: mock(() => undefined),
    spawnEditor: mock(() => {
      if (config.editedText !== undefined) files.set(tempFile, config.editedText);
      return config.spawnResult ?? { status: 0 };
    }),
    platform: mock(() => "linux" as NodeJS.Platform),
  };
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSupportedFiles, directoryUri, resolveRoot, resolveSupportedFile } from "./files";
import type { LspServerAdapter } from "./types";

describe("files", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("collects supported files while skipping dependency directories", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-files-"));
    await mkdir(join(tempDir, "src"));
    await mkdir(join(tempDir, "node_modules"));
    await writeFile(join(tempDir, "src", "main.ts"), "const ok = true;\n", "utf8");
    await writeFile(join(tempDir, "Dockerfile"), "FROM scratch\n", "utf8");
    await writeFile(join(tempDir, "node_modules", "skip.ts"), "ignored\n", "utf8");
    const adapter = fakeAdapter([".ts"], ["Dockerfile"]);

    // Act
    const files = collectSupportedFiles(adapter, tempDir, undefined, 10).map((file) => file.replace(`${tempDir}/`, ""));

    // Assert
    expect(files).toEqual(["Dockerfile", "src/main.ts"]);
  });

  test("rejects paths that resolve outside the workspace", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-files-"));
    const root = tempDir;
    const outside = await mkdtemp(join(tmpdir(), "pi-lsp-outside-"));
    await writeFile(join(outside, "main.ts"), "outside\n", "utf8");
    await symlink(join(outside, "main.ts"), join(root, "linked.ts"));
    const adapter = fakeAdapter([".ts"], []);

    try {
      // Act / Assert
      expect(() => collectSupportedFiles(adapter, root, ["linked.ts"], 10)).toThrow("outside workspace root");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("resolves supported files and root directories", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-files-"));
    await writeFile(join(tempDir, "main.ts"), "const ok = true;\n", "utf8");
    const adapter = fakeAdapter([".ts"], []);

    // Act
    const root = resolveRoot(tempDir);
    const file = resolveSupportedFile(adapter, root, "main.ts");
    const uri = directoryUri(root);

    // Assert
    expect(root).toBe(tempDir);
    expect(file).toBe(join(tempDir, "main.ts"));
    expect(uri.startsWith("file://")).toBe(true);
    expect(uri.endsWith("/")).toBe(true);
  });
});

function fakeAdapter(extensions: string[], fileNames: string[]): LspServerAdapter {
  return {
    name: "fake",
    defaultCommand: { command: "fake-lsp", args: [] },
    commandEnvVar: "PI_FAKE_LSP_COMMAND",
    missingCommandHint: "Install fake-lsp.",
    extensions,
    fileNames,
    skipDirectories: new Set(["node_modules"]),
    isSupportedFile: (filePath) =>
      extensions.some((extension) => filePath.endsWith(extension)) ||
      fileNames.some((name) => filePath.endsWith(`/${name}`)),
    languageIdFor: () => "typescript",
  };
}

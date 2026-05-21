import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filterAdapters, selectDiagnosticRoutes, selectFixRoute } from "./routes";
import type { LspServerAdapter } from "./types";

describe("routes", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("selects diagnostic routes by configured file support", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-routes-"));
    await writeFile(join(tempDir, "main.ts"), "const ok = true;\n", "utf8");
    await writeFile(join(tempDir, "Dockerfile"), "FROM scratch\n", "utf8");
    const adapters = [
      fakeAdapter("typescript", [".ts"], []),
      fakeAdapter("dockerfile", [".dockerfile"], ["Dockerfile"]),
    ];

    // Act
    const result = selectDiagnosticRoutes(adapters, { root: tempDir }, 10);

    // Assert
    expect(result.routes.map((route) => route.adapter.name)).toEqual(["typescript", "dockerfile"]);
    expect(result.routes[1]?.files[0]).toBe(join(tempDir, "Dockerfile"));
  });

  test("requires an explicit fix server when multiple servers match", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-routes-"));
    await writeFile(join(tempDir, "main.ts"), "const ok = true;\n", "utf8");
    const adapters = [fakeAdapter("typescript", [".ts"], []), fakeAdapter("tailwindcss", [".ts"], [])];

    // Act / Assert
    expect(() => selectFixRoute(adapters, { root: tempDir, path: "main.ts" })).toThrow("Multiple LSP servers");
  });

  test("filters selected server names and reports unknown names", () => {
    // Arrange
    const adapters = [fakeAdapter("typescript", [".ts"], []), fakeAdapter("pyright", [".py"], [])];

    // Act
    const filtered = filterAdapters(adapters, ["pyright", "pyright"]);

    // Assert
    expect(filtered.map((adapter) => adapter.name)).toEqual(["pyright"]);
    expect(() => filterAdapters(adapters, "missing")).toThrow("Unknown LSP server");
  });
});

function fakeAdapter(name: string, extensions: string[], fileNames: string[]): LspServerAdapter {
  return {
    name,
    defaultCommand: { command: `${name}-lsp`, args: [] },
    commandEnvVar: `PI_${name.toUpperCase()}_LSP_COMMAND`,
    missingCommandHint: `Install ${name}.`,
    extensions,
    fileNames,
    skipDirectories: new Set(),
    isSupportedFile: (filePath) =>
      extensions.some((extension) => filePath.endsWith(extension)) ||
      fileNames.some((fileName) => filePath.endsWith(`/${fileName}`)),
    languageIdFor: () => name,
  };
}

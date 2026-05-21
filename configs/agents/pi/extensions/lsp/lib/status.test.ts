import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStatusMessage, statusLevel } from "./status";
import type { LspServerAdapter } from "./types";

describe("status", () => {
  const originalPath = process.env.PATH;
  let tempDir: string | undefined;

  afterEach(async () => {
    process.env.PATH = originalPath;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("reports ready commands and configured routes", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-status-"));
    const commandPath = join(tempDir, "fake-lsp");
    await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(commandPath, 0o755);
    process.env.PATH = `${tempDir}:${originalPath ?? ""}`;
    const adapters = [fakeAdapter("fake", [".ts"], ["Dockerfile"]), fakeAdapter("missing", [".rs"], [])];

    // Act
    const message = buildStatusMessage(adapters, tempDir);
    const level = statusLevel(adapters, tempDir);

    // Assert
    expect(message).toContain("fake LSP command: fake-lsp --stdio");
    expect(message).toContain("fake routes: .ts, Dockerfile");
    expect(message).toContain("fake status: ready");
    expect(message).toContain("missing status: command missing");
    expect(level).toBe("warning");
  });
});

function fakeAdapter(name: string, extensions: string[], fileNames: string[]): LspServerAdapter {
  return {
    name,
    defaultCommand: { command: name === "fake" ? "fake-lsp" : "missing-lsp", args: ["--stdio"] },
    commandEnvVar: `PI_${name.toUpperCase()}_LSP_COMMAND`,
    missingCommandHint: `Install ${name}.`,
    extensions,
    fileNames,
    skipDirectories: new Set(),
    isSupportedFile: () => false,
    languageIdFor: () => name,
  };
}

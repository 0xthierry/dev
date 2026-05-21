import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandExists, commandFromEnv, splitCommand } from "./command";

describe("splitCommand", () => {
  test("splits quoted command arguments", () => {
    // Arrange
    const input = "uvx 'pyright langserver' --flag=one\\ two \"quoted value\"";

    // Act
    const parts = splitCommand(input);

    // Assert
    expect(parts).toEqual(["uvx", "pyright langserver", "--flag=one two", "quoted value"]);
  });
});

describe("commandFromEnv", () => {
  const envName = "PI_TEST_LSP_COMMAND";
  const originalValue = process.env[envName];

  afterEach(() => {
    if (originalValue === undefined) delete process.env[envName];
    else process.env[envName] = originalValue;
  });

  test("uses an environment override when present", () => {
    // Arrange
    process.env[envName] = "custom-lsp --stdio";

    // Act
    const command = commandFromEnv(envName, { command: "fallback", args: [] });

    // Assert
    expect(command).toEqual({ command: "custom-lsp", args: ["--stdio"] });
  });

  test("falls back when the environment override is blank", () => {
    // Arrange
    process.env[envName] = "   ";

    // Act
    const command = commandFromEnv(envName, { command: "fallback", args: ["server"] });

    // Assert
    expect(command).toEqual({ command: "fallback", args: ["server"] });
  });
});

describe("commandExists", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("finds executable commands by relative path", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-command-"));
    const commandPath = join(tempDir, "fake-lsp");
    await writeFile(commandPath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(commandPath, 0o755);

    // Act
    const exists = commandExists("./fake-lsp", tempDir);

    // Assert
    expect(exists).toBe(true);
  });
});

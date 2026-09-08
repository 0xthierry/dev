import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

test("the sidecar launcher overrides only its provider and preserves arguments and paths with spaces", async () => {
  // Arrange
  const directory = await mkdtemp(join(tmpdir(), "browser launcher "));
  const fakeCli = join(directory, "bundled codex");
  await writeFile(fakeCli, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
  await chmod(fakeCli, 0o700);

  try {
    // Act
    const result = await exec(
      fileURLToPath(new URL("./codex-browser-cli.sh", import.meta.url)),
      ["app-server", "--listen", "stdio://", "argument with spaces"],
      {
        env: { ...process.env, BROWSER_USE_CODEX_CLI: fakeCli },
      },
    );

    // Assert
    expect(result.stdout.split("\n")).toEqual([
      "-c",
      'model_provider="openai"',
      "app-server",
      "--listen",
      "stdio://",
      "argument with spaces",
      "",
    ]);
    expect(result.stderr).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

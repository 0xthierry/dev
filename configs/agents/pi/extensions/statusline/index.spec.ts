import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/statusline");

type JsonObject = Record<string, unknown>;

describe("statusline extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("publishes clickable PR and git change counts through Pi RPC setStatus", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-statusline-e2e-"));
    await createRepositoryWithPrBranchAndChanges(tempDir);
    const fakeBin = await createFakeGh(tempDir);

    // Act
    harness = await startPiRpcHarness({
      cwd: tempDir,
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        PI_STATUSLINE_STOCK_SYMBOL: "off",
      },
    });
    const statusEvent = await harness.waitForEvent(isStatuslineSetStatusEvent, 30_000);

    // Assert
    expect(statusEvent.statusText).toContain("PR #42");
    expect(statusEvent.statusText).toContain("\x1b]8;;https://github.com/0xthierry/dev/pull/42\x1b\\");
    expect(statusEvent.statusText).toContain("\x1b[38;");
    expect(statusEvent.statusText).toContain("+1");
    expect(statusEvent.statusText).toContain("-0");
    expect(statusEvent.statusText).toContain("~1");
    expect(statusEvent.statusText).toContain("?1");
    expect(harness.stderr()).toBe("");
  }, 60_000);
});

async function createRepositoryWithPrBranchAndChanges(cwd: string): Promise<void> {
  await runGit(cwd, ["init"]);
  await runGit(cwd, ["config", "user.email", "statusline@example.com"]);
  await runGit(cwd, ["config", "user.name", "Statusline E2E"]);
  await writeFile(join(cwd, ".gitignore"), "bin/\n", "utf8");
  await writeFile(join(cwd, "file.txt"), "first line\n", "utf8");
  await runGit(cwd, ["add", ".gitignore", "file.txt"]);
  await runGit(cwd, ["commit", "-m", "initial"]);
  await runGit(cwd, ["remote", "add", "origin", "git@github.com:0xthierry/dev.git"]);
  await runGit(cwd, ["checkout", "-b", "feature/pr-42-statusline"]);
  await writeFile(join(cwd, "file.txt"), "first line\nsecond line\n", "utf8");
  await writeFile(join(cwd, "notes.md"), "untracked\n", "utf8");
}

async function createFakeGh(directory: string): Promise<string> {
  const bin = join(directory, "bin");
  await mkdir(bin);
  const ghPath = join(bin, "gh");
  await writeFile(ghPath, "#!/bin/sh\nexit 1\n", "utf8");
  await chmod(ghPath, 0o755);
  return bin;
}

async function runGit(cwd: string, args: string[]): Promise<void> {
  const process = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

function isStatuslineSetStatusEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setStatus" &&
    event.statusKey === "thierry-statusline" &&
    typeof event.statusText === "string"
  );
}

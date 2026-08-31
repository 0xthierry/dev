import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createAgentProcess } from "./process";

let fixtureDirectory: string | undefined;

afterEach(async () => {
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
  fixtureDirectory = undefined;
});

test("grace escalation terminates a real grandchild process tree", async () => {
  // Arrange
  if (process.platform === "win32") return;
  fixtureDirectory = await mkdtemp(join(tmpdir(), "subagent-process-tree-"));
  const executable = join(fixtureDirectory, "pi");
  await writeFile(
    executable,
    `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
process.stderr.write("grandchild:" + grandchild.pid + "\\n");
process.on("SIGTERM", () => {});
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type !== "get_state") return;
  process.stdout.write(JSON.stringify({
    id: command.id,
    type: "response",
    command: "get_state",
    success: true,
    data: {
      model: { provider: "test", id: "tree" },
      thinkingLevel: "off",
      isStreaming: false,
      isCompacting: false,
      sessionFile: "/tmp/tree-session.jsonl",
      sessionId: "tree-session",
      pendingMessageCount: 0
    }
  }) + "\\n");
});
setInterval(() => {}, 1000);
`,
    { mode: 0o700 },
  );
  await chmod(executable, 0o700);
  const agent = createAgentProcess({
    invocation: {
      command: "pi",
      args: [],
      cwd: fixtureDirectory,
      env: { ...process.env, PATH: `${fixtureDirectory}${delimiter}${process.env.PATH ?? ""}` },
    },
    execution: { provider: "test", model: "tree", effort: "off" },
    terminationGraceMs: 10,
  });
  await agent.startup();
  const match = /grandchild:(\d+)/.exec(agent.getStderrTail());
  expect(match).not.toBeNull();
  const grandchildPid = Number(match?.[1]);

  // Act
  await agent.close();
  const gone = await waitUntilGone(grandchildPid);

  // Assert
  expect(gone).toBe(true);
}, 10_000);

async function waitUntilGone(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (errorCode(error) === "ESRCH") return true;
      throw error;
    }
    await Bun.sleep(10);
  }
  return false;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

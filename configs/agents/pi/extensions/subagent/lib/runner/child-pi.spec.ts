import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { AgentDefinition } from "../agents/types";
import { runChildPiAgent } from "./child-pi";
import type { AgentRunRequest } from "./invocation";
import type { AgentRunResult } from "./run-result";

describe("runChildPiAgent", () => {
  let tempDir: string | undefined;
  let previousPath: string | undefined;
  let previousAgentDir: string | undefined;

  afterEach(async () => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;

    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("finishes after agent_end when the child process keeps running", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-subagent-child-pi-spec-"));
    const binDir = join(tempDir, "bin");
    const agentDir = join(tempDir, "pi-agent");
    await mkdir(binDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
    await writeFakePiExecutable(join(binDir, "pi"));

    previousPath = process.env.PATH;
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PATH = [binDir, previousPath].filter((value): value is string => Boolean(value)).join(delimiter);
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const startedAt = Date.now();
    const progress: AgentRunResult[] = [];

    // Act
    const result = await runChildPiAgent(runRequest(tempDir), undefined, (current) => progress.push(current));

    // Assert
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(result.status).toBe("succeeded");
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.finalOutput).toContain("Fake child output.");
    expect(result.agentId).toBe("fake-child-session-id");
    expect(result.outputArtifactPath).toBeTruthy();
    expect(result.durationMs).toBeGreaterThan(1_000);
    expect(progress.some((current) => current.status === "running" && (current.durationMs ?? 0) >= 1_000)).toBe(true);
  }, 10_000);
});

async function writeFakePiExecutable(filePath: string): Promise<void> {
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "Fake child output." }],
    model: "fake-model",
    stopReason: "stop",
    usage: {
      input: 1,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 3,
      cost: { total: 0 },
    },
  };
  const script = [
    "#!/usr/bin/env node",
    `const message = ${JSON.stringify(message)};`,
    "const events = [",
    "  { type: 'session', id: 'fake-child-session-id' },",
    "  { type: 'message_end', message },",
    "  { type: 'turn_end', message, toolResults: [] },",
    "  { type: 'agent_end', messages: [message] },",
    "];",
    "console.log(JSON.stringify(events[0]));",
    "setTimeout(() => {",
    "  for (const event of events.slice(1)) console.log(JSON.stringify(event));",
    "  setInterval(() => {}, 1000);",
    "}, 1100);",
    "",
  ].join("\n");
  await writeFile(filePath, script, "utf8");
  await chmod(filePath, 0o755);
}

function runRequest(cwd: string): AgentRunRequest {
  return {
    agent: agentDefinition("fake-agent"),
    task: "Return fake output",
    context: "fresh",
    cwd,
    agentSessionDir: join(cwd, "agent-sessions"),
  };
}

function agentDefinition(name: string): AgentDefinition {
  return {
    name,
    description: `${name} description`,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description: `${name} description` },
  };
}

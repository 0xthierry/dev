import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../_shared/testing/fake-pi";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import { CHILD_EXTENSIONS_ENV, CHILD_NO_EXTENSIONS_ENV, CHILD_UNSET_ENV } from "./lib/runner/invocation";
import { createSubagentRuntime } from "./lib/runtime";
import type { AgentToolDetails } from "./lib/tools/agent-tool";
import { executeAgentTool } from "./lib/tools/agent-tool";

const extensionPath = "configs/agents/pi/extensions/subagent";
const fauxProviderExtensionPath = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";
const childResponse = "Subagent E2E child result.";

type JsonObject = Record<string, unknown>;

describe("subagent extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("executes the Agent tool through the Pi agent loop", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-subagent-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    await mkdir(join(piAgentDir, "agents"), { recursive: true });
    await writeFile(
      join(piAgentDir, "agents", "echo-agent.md"),
      [
        "---",
        "name: echo-agent",
        "description: Deterministic E2E echo agent",
        "---",
        "Return the configured deterministic provider response.",
      ].join("\n"),
      "utf8",
    );

    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "Agent",
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        PI_CODING_AGENT_DIR: piAgentDir,
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: childResponse,
        [FAUX_TOOL_CALLS_ENV]: JSON.stringify([
          {
            id: "subagent-e2e-call",
            name: "Agent",
            arguments: { subagent_type: "echo-agent", prompt: "Return the deterministic child response." },
          },
        ]),
        [CHILD_NO_EXTENSIONS_ENV]: "1",
        [CHILD_EXTENSIONS_ENV]: resolve(fauxProviderExtensionPath).split(delimiter).join(delimiter),
        [CHILD_UNSET_ENV]: FAUX_TOOL_CALLS_ENV,
      },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "Delegate to echo-agent." });
    const toolEnd = await harness.waitForEvent(isAgentToolEnd, 90_000);
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 90_000);

    // Assert
    expect(response.success).toBe(true);
    expect(JSON.stringify(toolEnd)).toContain(childResponse);
    expect(JSON.stringify(toolEnd)).toContain("echo-agent");
    expect(JSON.stringify(agentEnd)).toContain(childResponse);
    const projectDirs = await readdir(join(piAgentDir, "agent-sessions"));
    expect(projectDirs.length).toBe(1);
    const sessionFiles = await readdir(join(piAgentDir, "agent-sessions", projectDirs[0]));
    expect(sessionFiles.some((file) => file.endsWith(".jsonl"))).toBe(true);
    expect(harness.stderr()).toBe("");
  }, 120_000);

  test("resumes a saved child Pi session by agent_id", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-subagent-resume-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    await mkdir(join(piAgentDir, "agents"), { recursive: true });
    await writeFile(
      join(piAgentDir, "agents", "echo-agent.md"),
      [
        "---",
        "name: echo-agent",
        "description: Deterministic E2E echo agent",
        "---",
        "Return the configured deterministic provider response.",
      ].join("\n"),
      "utf8",
    );

    const fakePi = createFakePi();
    const runtime = createSubagentRuntime();
    let branchEntries: unknown[] = [];
    const ctx = fakePi.createContext({
      cwd: process.cwd(),
      model: { provider: FAUX_PROVIDER_NAME, id: FAUX_MODEL_ID },
      sessionManager: {
        getSessionFile: () => undefined,
        getBranch: () => branchEntries,
      },
    }) as unknown as ExtensionContext;
    const restoreEnv = setResumeSpecEnv(piAgentDir);

    try {
      process.env[FAUX_RESPONSE_TEXT_ENV] = "First child response.";

      // Act
      const first = await executeAgentTool(
        fakePi.pi,
        runtime,
        { subagent_type: "echo-agent", prompt: "Start the child session." },
        undefined,
        undefined,
        ctx,
      );
      const firstRun = first.details?.results[0];
      branchEntries = [agentToolResultEntry(first.details)];
      process.env[FAUX_RESPONSE_TEXT_ENV] = "Second child response.";
      const second = await executeAgentTool(
        fakePi.pi,
        runtime,
        { agent_id: firstRun?.agentId, prompt: "Continue the child session." },
        undefined,
        undefined,
        ctx,
      );

      // Assert
      expect(firstRun?.agentId).toBeTruthy();
      expect(firstRun?.sessionFile).toBeTruthy();
      expect(second.content[0]?.type === "text" ? second.content[0].text : "").toContain(
        `agent_id: ${firstRun?.agentId}`,
      );
      expect(second.content[0]?.type === "text" ? second.content[0].text : "").toContain("Second child response.");
      expect(second.details?.results[0]).toMatchObject({
        agentId: firstRun?.agentId,
        sessionFile: firstRun?.sessionFile,
        context: "resume",
      });
      const sessionText = await readFile(firstRun?.sessionFile ?? "", "utf8");
      expect(sessionText).toContain("First child response.");
      expect(sessionText).toContain("Second child response.");
    } finally {
      restoreEnv();
    }
  }, 120_000);
});

function isAgentToolEnd(event: JsonObject): boolean {
  return event.type === "tool_execution_end" && event.toolName === "Agent";
}

function agentToolResultEntry(details: AgentToolDetails | undefined): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "Agent",
      details,
    },
  };
}

function setResumeSpecEnv(piAgentDir: string): () => void {
  const names = [
    "PI_CODING_AGENT_DIR",
    FAUX_API_KEY_ENV,
    FAUX_RESPONSE_TEXT_ENV,
    FAUX_TOOL_CALLS_ENV,
    CHILD_NO_EXTENSIONS_ENV,
    CHILD_EXTENSIONS_ENV,
    CHILD_UNSET_ENV,
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));

  process.env.PI_CODING_AGENT_DIR = piAgentDir;
  process.env[FAUX_API_KEY_ENV] = "test-key";
  delete process.env[FAUX_TOOL_CALLS_ENV];
  process.env[CHILD_NO_EXTENSIONS_ENV] = "1";
  process.env[CHILD_EXTENSIONS_ENV] = resolve(fauxProviderExtensionPath);
  process.env[CHILD_UNSET_ENV] = FAUX_TOOL_CALLS_ENV;

  return () => {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

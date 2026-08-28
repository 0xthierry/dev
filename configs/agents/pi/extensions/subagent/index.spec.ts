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
import { SUBAGENT_CONFIG_FILE_NAME } from "./lib/agents/config";
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

  test("executes the agent tool and normalizes legacy max effort through the Pi agent loop", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-subagent-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    const projectRoot = join(tempDir, "repo");
    await mkdir(join(piAgentDir, "agents"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
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
    await writeSubagentConfig(join(projectRoot, SUBAGENT_CONFIG_FILE_NAME));

    harness = await startPiRpcHarness({
      cwd: projectRoot,
      extensionPath: resolve(extensionPath),
      args: [
        "--approve",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        resolve(fauxProviderExtensionPath),
        "--tools",
        "agent",
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
            name: "agent",
            arguments: {
              subagent_type: "echo-agent",
              prompt: "Return the deterministic child response.",
              effort: "max",
            },
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
    expect(JSON.stringify(toolEnd)).toContain('"thinking":"high"');
    expect(JSON.stringify(toolEnd)).toMatch(/"durationMs":\d+/);
    expect(JSON.stringify(agentEnd)).toContain(childResponse);
    const projectDirs = await readdir(join(piAgentDir, "agent-sessions"));
    expect(projectDirs.length).toBe(1);
    const sessionFiles = await readdir(join(piAgentDir, "agent-sessions", projectDirs[0]));
    expect(sessionFiles.some((file) => file.endsWith(".jsonl"))).toBe(true);
    const artifactProjectKeys = await readdir(join(piAgentDir, "agent-sessions-artifacts"));
    expect(artifactProjectKeys.length).toBe(1);
    const artifactSessionIds = await readdir(join(piAgentDir, "agent-sessions-artifacts", artifactProjectKeys[0]));
    expect(artifactSessionIds.length).toBe(1);
    const artifactDir = join(
      piAgentDir,
      "agent-sessions-artifacts",
      artifactProjectKeys[0],
      artifactSessionIds[0],
      "artifacts",
    );
    const artifactFiles = await readdir(artifactDir);
    const outputFile = artifactFiles.find((file) => file.endsWith("_echo-agent_output.md"));
    expect(artifactFiles.some((file) => file.endsWith("_echo-agent_input.md"))).toBe(true);
    expect(outputFile).toBeTruthy();
    expect(artifactFiles.some((file) => file.endsWith(".jsonl"))).toBe(false);
    expect(artifactFiles.some((file) => file.endsWith("_echo-agent_meta.json"))).toBe(true);
    expect(await readFile(join(artifactDir, outputFile ?? ""), "utf8")).toContain(childResponse);
    expect(harness.stderr()).toBe("");
  }, 120_000);

  test("applies repo overrides to new and resumed child sessions", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-subagent-resume-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    const projectRoot = join(tempDir, "repo");
    await mkdir(join(piAgentDir, "agents"), { recursive: true });
    await mkdir(join(projectRoot, ".git"), { recursive: true });
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
    const configPath = join(projectRoot, SUBAGENT_CONFIG_FILE_NAME);
    await writeSubagentConfig(configPath, "high");

    const fakePi = createFakePi();
    const runtime = createSubagentRuntime();
    let branchEntries: unknown[] = [];
    const ctx = fakePi.createContext({
      cwd: projectRoot,
      model: { provider: "missing-parent-provider", id: "missing-parent-model" },
      isProjectTrusted: () => true,
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
        { subagent_type: "echo-agent", prompt: "Start the child session.", effort: "low" },
        undefined,
        undefined,
        ctx,
      );
      const firstRun = first.details?.results[0];
      branchEntries = [agentToolResultEntry(first.details)];
      process.env[FAUX_RESPONSE_TEXT_ENV] = "Second child response.";
      await writeSubagentConfig(configPath, "medium");
      const second = await executeAgentTool(
        fakePi.pi,
        runtime,
        { agent_id: firstRun?.agentId, prompt: "Continue the child session.", effort: "high" },
        undefined,
        undefined,
        ctx,
      );

      // Assert
      expect(firstRun?.agentId).toBeTruthy();
      expect(firstRun?.sessionFile).toBeTruthy();
      expect(firstRun?.model).toBe(FAUX_MODEL_ID);
      expect(firstRun?.thinking).toBe("high");
      expect(firstRun?.durationMs).toBeGreaterThan(0);
      expect(second.content[0]?.type === "text" ? second.content[0].text : "").toContain(
        `agent_id: ${firstRun?.agentId}`,
      );
      expect(second.content[0]?.type === "text" ? second.content[0].text : "").toContain("Second child response.");
      expect(firstRun?.outputArtifactPath).toBeTruthy();
      expect(await readFile(firstRun?.outputArtifactPath ?? "", "utf8")).toContain("First child response.");
      expect(second.details?.results[0]).toMatchObject({
        agentId: firstRun?.agentId,
        sessionFile: firstRun?.sessionFile,
        context: "resume",
        model: FAUX_MODEL_ID,
        thinking: "medium",
      });
      expect(second.details?.results[0].outputArtifactPath).toBeTruthy();
      expect(await readFile(second.details?.results[0].outputArtifactPath ?? "", "utf8")).toContain(
        "Second child response.",
      );
      const sessionText = await readFile(firstRun?.sessionFile ?? "", "utf8");
      expect(sessionText).toContain("First child response.");
      expect(sessionText).toContain("Second child response.");
    } finally {
      restoreEnv();
    }
  }, 120_000);
});

async function writeSubagentConfig(configPath: string, effort?: "low" | "medium" | "high"): Promise<void> {
  await writeFile(
    configPath,
    JSON.stringify({
      agents: {
        "echo-agent": {
          provider: FAUX_PROVIDER_NAME,
          model: FAUX_MODEL_ID,
          ...(effort ? { effort, allowEffortOverride: false } : {}),
        },
      },
    }),
    "utf8",
  );
}

function isAgentToolEnd(event: JsonObject): boolean {
  return event.type === "tool_execution_end" && event.toolName === "agent";
}

function agentToolResultEntry(details: AgentToolDetails | undefined): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "agent",
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

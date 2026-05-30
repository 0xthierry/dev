import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import {
  WORKFLOW_CHILD_EXTENSIONS_ENV,
  WORKFLOW_CHILD_NO_EXTENSIONS_ENV,
  WORKFLOW_CHILD_UNSET_ENV,
} from "./lib/runner/invocation";

const extensionPath = "configs/agents/pi/extensions/dynamic-workflow";
const fauxProviderExtensionPath = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";
const childResponse = "Dynamic workflow child E2E result.";

type JsonObject = Record<string, unknown>;

describe("dynamic workflow extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("executes a workflow tool call through the Pi agent loop", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-dynamic-workflow-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    await mkdir(piAgentDir, { recursive: true });
    const workflowScript = `export const meta = { name: 'e2e_workflow', description: 'E2E workflow', phases: [{ title: 'Run' }] }
phase('Run')
const result = await agent('Return the deterministic child provider response.', { label: 'child echo' })
return { result }
`;

    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "workflow",
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
            id: "dynamic-workflow-e2e-call",
            name: "workflow",
            arguments: { script: workflowScript },
          },
        ]),
        [WORKFLOW_CHILD_NO_EXTENSIONS_ENV]: "1",
        [WORKFLOW_CHILD_EXTENSIONS_ENV]: resolve(fauxProviderExtensionPath).split(delimiter).join(delimiter),
        [WORKFLOW_CHILD_UNSET_ENV]: FAUX_TOOL_CALLS_ENV,
      },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "Run the E2E dynamic workflow." }, 90_000);
    const toolEnd = await harness.waitForEvent(isWorkflowToolEnd, 90_000);
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 90_000);
    const outputFile = await findFile(join(piAgentDir, "workflow-runs"), "output.md");
    const outputText = await readFile(outputFile, "utf8");

    // Assert
    expect(response.success).toBe(true);
    expect(JSON.stringify(toolEnd)).toContain(childResponse);
    expect(JSON.stringify(toolEnd)).toContain("e2e_workflow");
    expect(JSON.stringify(agentEnd)).toContain(childResponse);
    expect(outputText).toContain(childResponse);
    expect(harness.stderr()).toBe("");
  }, 120_000);
});

async function findFile(dir: string, fileName: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(path, fileName).catch(() => undefined);
      if (nested) return nested;
    } else if (entry.name === fileName) {
      return path;
    }
  }
  throw new Error(`${fileName} not found under ${dir}`);
}

function isWorkflowToolEnd(event: JsonObject): boolean {
  return event.type === "tool_execution_end" && event.toolName === "workflow";
}

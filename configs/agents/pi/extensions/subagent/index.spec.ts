import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { CHILD_EXTENSIONS_ENV, CHILD_NO_EXTENSIONS_ENV, CHILD_UNSET_ENV } from "./lib/runner/invocation";

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
    expect(harness.stderr()).toBe("");
  }, 120_000);
});

function isAgentToolEnd(event: JsonObject): boolean {
  return event.type === "tool_execution_end" && event.toolName === "Agent";
}

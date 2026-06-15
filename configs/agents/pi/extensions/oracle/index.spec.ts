import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = import.meta.dir;
const fauxProviderExtensionPath = resolve(import.meta.dir, "../_shared/testing/faux-provider-extension.ts");
const expectedFinalResponseText = "oracle e2e complete";

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("oracle extension E2E", () => {
  let harness: PiRpcHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  test("consults the Oracle through the agent tool loop", async () => {
    // Arrange
    harness = await startPiRpcHarness({
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        extensionPath,
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "oracle",
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedFinalResponseText,
        [FAUX_TOOL_CALLS_ENV]: JSON.stringify([
          {
            id: "oracle-e2e",
            name: "oracle",
            arguments: {
              prompt: "Reply with exactly one word: pong",
            },
          },
        ]),
      },
    });

    // Act
    const promptResponse = await harness.request({ type: "prompt", message: "Consult the configured oracle." });
    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "oracle",
      180_000,
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(toolEnd)).toContain("The Oracle answered");
    expect(eventText(toolEnd).toLowerCase()).toContain("pong");
    expect(eventText(agentEnd)).toContain(expectedFinalResponseText);
    expect(harness.stderr()).toBe("");
  }, 240_000);
});

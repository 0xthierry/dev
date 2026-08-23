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

type JsonObject = Record<string, unknown>;

const extensionPath = resolve("configs/agents/pi/extensions/computer-use");
const fauxProviderExtensionPath = resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts");
const expectedResponseText = "Computer Use extension e2e complete.";

describe("computer-use extension E2E", () => {
  let harness: PiRpcHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  test("reports broker status and executes the source-owned tool through Pi", async () => {
    // Arrange
    if (process.platform !== "darwin") {
      throw new Error("The computer-use E2E requires macOS");
    }
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "computer_use",
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedResponseText,
        [FAUX_TOOL_CALLS_ENV]: JSON.stringify([
          {
            id: "computer-use-list-apps",
            name: "computer_use",
            arguments: { code: "emit(await sky.list_apps());" },
          },
        ]),
      },
      startupTimeoutMs: 20_000,
    });

    // Act
    const commandsResponse = await harness.request({ type: "get_commands" });
    const commandResponse = await harness.request({ type: "prompt", message: "/computer-use-status" });
    const statusEvent = await harness.waitForEvent(isComputerUseStatusEvent, 30_000);
    const promptResponse = await harness.request({ type: "prompt", message: "List the open macOS applications." });
    const toolStart = await harness.waitForEvent(
      (event) => event.type === "tool_execution_start" && event.toolName === "computer_use",
      60_000,
    );
    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "computer_use",
      60_000,
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(commandNames(commandsResponse)).toContain("computer-use-status");
    expect(commandResponse.success).toBe(true);
    expect(statusEvent.message).toContain('"permissionMode": "no-permissions"');
    expect(statusEvent.message).toContain('"brokerVerified":');
    expect(statusEvent.message).toContain('"get_app_state"');
    expect(promptResponse.success).toBe(true);
    expect(toolStart).toMatchObject({
      toolName: "computer_use",
      args: { code: "emit(await sky.list_apps());" },
    });
    expect(toolEnd.toolName).toBe("computer_use");
    expect(toolEnd.isError).toBe(false);
    expect(JSON.stringify(toolEnd)).toContain('"list_apps"');
    expect(JSON.stringify(toolEnd)).not.toContain("execution exceeded");
    expect(JSON.stringify(agentEnd)).toContain(expectedResponseText);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function commandNames(response: JsonObject): string[] {
  const data = response.data as { commands?: Array<{ name?: unknown }> } | undefined;
  return (
    data?.commands?.map((command) => command.name).filter((name): name is string => typeof name === "string") ?? []
  );
}

function isComputerUseStatusEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes('"permissionMode": "no-permissions"')
  );
}

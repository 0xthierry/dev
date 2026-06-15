import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/fff");
const fauxProviderExtensionPath = resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts");
const expectedResponseText = "fff extension e2e complete";

type JsonObject = Record<string, unknown>;

describe("fff extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("overrides find and returns FFF search results through the agent tool loop", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-fff-e2e-"));
    await mkdir(join(tempDir, "src"));
    await writeFile(join(tempDir, "src", "quote_builder.ts"), "export const quoteBuilder = true;\n", "utf8");
    await writeFile(join(tempDir, "src", "unrelated.ts"), "export const other = true;\n", "utf8");

    harness = await startPiRpcHarness({
      cwd: tempDir,
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "find",
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
            id: "fff-find-fake",
            name: "find",
            arguments: { pattern: "quote_builder", limit: 5 },
          },
        ]),
      },
      startupTimeoutMs: 20_000,
    });

    // Act
    const commandsResponse = await harness.request({ type: "get_commands" });
    const commandResponse = await harness.request({ type: "prompt", message: "/fff-health" });
    const healthEvent = await harness.waitForEvent(isFffHealthNotifyEvent, 30_000);
    const rescanResponse = await harness.request({ type: "prompt", message: "/fff-rescan" });
    const rescanEvent = await harness.waitForEvent(isFffRescanNotifyEvent, 30_000);
    const promptResponse = await harness.request({ type: "prompt", message: "Find quote_builder files." });
    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "find",
      60_000,
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(commandNames(commandsResponse)).toContain("fff-health");
    expect(commandNames(commandsResponse)).toContain("fff-rescan");
    expect(commandResponse.success).toBe(true);
    expect(healthEvent.message).toContain("Tools: overriding grep, find, and multi_grep");
    expect(rescanResponse.success).toBe(true);
    expect(rescanEvent.message).toBe("FFF rescan triggered");
    expect(promptResponse.success).toBe(true);
    expect(JSON.stringify(toolEnd)).toContain("src/quote_builder.ts");
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

function isFffHealthNotifyEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes("Tools: overriding grep, find, and multi_grep")
  );
}

function isFffRescanNotifyEvent(event: JsonObject): boolean {
  return event.type === "extension_ui_request" && event.method === "notify" && event.message === "FFF rescan triggered";
}

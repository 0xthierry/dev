import { afterEach, describe, expect, test } from "bun:test";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const expectedResponseText = "web-access extension e2e complete";
const extensionPath = "configs/agents/pi/extensions/web-access";
const fauxProviderExtensionPath = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";

function eventText(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

describe("web-access extension E2E", () => {
  let harness: PiRpcHarness | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
  });

  test("extracts a YouTube video through Pi's Node runtime", async () => {
    // Arrange
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "fetch_content",
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
            id: "web-access-fetch-youtube",
            name: "fetch_content",
            arguments: {
              url: "https://www.youtube.com/watch?v=WmR9IMUD_CY",
            },
          },
        ]),
      },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "Use the configured faux response." });
    expect(response.success).toBe(true);
    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "fetch_content",
      150_000,
    );
    await harness.waitForEvent((event) => event.type === "agent_end", 30_000);

    // Assert
    expect(toolEnd.isError).toBe(false);
    expect(eventText(toolEnd)).toContain("WebRTC");
    expect(harness.stderr()).toBe("");
  }, 180_000);

  test("executes fetch_content through the agent tool loop", async () => {
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "fetch_content",
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
            id: "web-access-fetch-pdf",
            name: "fetch_content",
            arguments: { url: "https://example.com/report.pdf" },
          },
        ]),
      },
    });

    const promptResponse = await harness.request({
      type: "prompt",
      message: "Use the configured faux response.",
    });
    expect(promptResponse.success).toBe(true);

    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "fetch_content",
      60_000,
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    expect(toolEnd.isError).toBe(true);
    expect(eventText(toolEnd)).toContain("PDF files are unsupported by this extension.");
    expect(eventText(agentEnd)).toContain(expectedResponseText);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

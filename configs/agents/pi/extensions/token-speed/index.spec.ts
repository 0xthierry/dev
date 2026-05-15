import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import { TOKEN_SPEED_STATUS_KEY } from "./lib/constants";

const extensionPath = resolve("configs/agents/pi/extensions/token-speed");
const fauxProviderExtensionPath = resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts");

type JsonObject = Record<string, unknown>;

describe("token-speed extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("publishes idle and measured TPS through Pi RPC setStatus", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-token-speed-e2e-"));
    harness = await startPiRpcHarness({
      cwd: tempDir,
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        HOME: tempDir,
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: "Token speed E2E response.",
      },
    });
    const idleStatus = await harness.waitForEvent(isIdleTokenSpeedStatusEvent, 30_000);

    // Act
    const response = await harness.request({ type: "prompt", message: "Reply with the configured faux response." });
    const measuredStatus = await harness.waitForEvent(isMeasuredTokenSpeedStatusEvent, 60_000);
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(response.success).toBe(true);
    expect(idleStatus.statusText).toContain("⚡ TPS:");
    expect(idleStatus.statusText).toContain("--");
    expect(measuredStatus.statusText).toContain("tok/s");
    expect(agentEnd.type).toBe("agent_end");
    expect(harness.events.some((event) => event.type === "message_update")).toBe(true);
    expect(harness.events.filter(isTokenSpeedStatusEvent).length).toBeGreaterThanOrEqual(3);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function isTokenSpeedStatusEvent(event: JsonObject): event is JsonObject & { statusText: string } {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setStatus" &&
    event.statusKey === TOKEN_SPEED_STATUS_KEY &&
    typeof event.statusText === "string"
  );
}

function isIdleTokenSpeedStatusEvent(event: JsonObject): event is JsonObject & { statusText: string } {
  return isTokenSpeedStatusEvent(event) && event.statusText.includes("--");
}

function isMeasuredTokenSpeedStatusEvent(event: JsonObject): event is JsonObject & { statusText: string } {
  return isTokenSpeedStatusEvent(event) && event.statusText.includes("tok/s");
}

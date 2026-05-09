import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = import.meta.dir;
const fauxProviderExtensionPath = resolve(import.meta.dir, "../_shared/testing/faux-provider-extension.ts");
const expectedResponseText = "project rules e2e complete";

function eventText(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

describe("project-rules extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("announces activated rules through Pi RPC", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-project-rules-e2e-"));
    await mkdir(join(tempDir, ".git"));
    await mkdir(join(tempDir, ".pi", "rules"), { recursive: true });
    await writeFile(join(tempDir, ".pi", "rules", "testing.md"), "# Testing\n\nRun the relevant tests.");

    harness = await startPiRpcHarness({
      cwd: tempDir,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        extensionPath,
        "-e",
        fauxProviderExtensionPath,
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedResponseText,
      },
    });

    // Act
    const promptResponse = await harness.request({ type: "prompt", message: "Say done." });
    const activationEvent = await harness.waitForEvent((event) => eventText(event).includes("Activated project rule"));
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(activationEvent)).toContain(".pi/rules/testing.md");
    expect(eventText(agentEnd)).toContain(expectedResponseText);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

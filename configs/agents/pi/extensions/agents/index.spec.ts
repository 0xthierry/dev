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

const extensionPath = import.meta.dir;
const fauxProviderExtensionPath = resolve(import.meta.dir, "../_shared/testing/faux-provider-extension.ts");
const expectedResponseText = "agents e2e complete";

function eventText(event: Record<string, unknown>): string {
  return JSON.stringify(event);
}

describe("agents extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("injects nested AGENTS.md context when a file in that subtree is read", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-agents-e2e-"));
    await mkdir(join(tempDir, ".git"));
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await writeFile(join(tempDir, "tests", "AGENTS.md"), "# Tests\n\nUse the test helpers.");
    await writeFile(join(tempDir, "tests", "foo.test.ts"), "export const ok = true;\n");

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
        [FAUX_TOOL_CALLS_ENV]: JSON.stringify([{ name: "read", arguments: { path: "tests/foo.test.ts" } }]),
      },
    });

    // Act
    const promptResponse = await harness.request({ type: "prompt", message: "Read the test file." });
    const agentsContextEvent = await harness.waitForEvent((event) =>
      eventText(event).includes("Nested AGENTS.md / CLAUDE.md Context"),
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(agentsContextEvent)).toContain("tests/AGENTS.md");
    expect(eventText(agentsContextEvent)).toContain("Use the test helpers.");
    expect(eventText(agentEnd)).toContain(expectedResponseText);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

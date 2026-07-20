import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import {
  CODEX_DETAILED_REASONING_TEST_API_KEY_ENV,
  CODEX_DETAILED_REASONING_TEST_MODEL,
  CODEX_DETAILED_REASONING_TEST_PROVIDER,
} from "./codex-detailed-reasoning-test-provider";

const extensionPath = import.meta.dir;
const testProviderPath = resolve(import.meta.dir, "codex-detailed-reasoning-test-provider.ts");

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("codex-detailed-reasoning extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempProject: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempProject) await rm(tempProject, { recursive: true, force: true });
    tempProject = undefined;
  });

  test("upgrades Codex-shaped provider payloads to detailed reasoning summaries", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-codex-detailed-reasoning-e2e-"));
    harness = await startPiRpcHarness({
      cwd: tempProject,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        extensionPath,
        "-e",
        testProviderPath,
        "--provider",
        CODEX_DETAILED_REASONING_TEST_PROVIDER,
        "--model",
        CODEX_DETAILED_REASONING_TEST_MODEL,
      ],
      env: {
        [CODEX_DETAILED_REASONING_TEST_API_KEY_ENV]: "test-key",
      },
    });

    // Act
    const promptResponse = await harness.request({
      type: "prompt",
      message: "Report the provider payload reasoning summary.",
    });
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(agentEnd)).toContain("reasoning_summary=detailed");
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

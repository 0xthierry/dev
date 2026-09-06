import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import {
  CODEX_FAST_MODE_TEST_API_KEY_ENV,
  CODEX_FAST_MODE_TEST_MODEL,
  CODEX_FAST_MODE_TEST_PROVIDER,
} from "./codex-fast-mode-test-provider";

const extensionPath = import.meta.dir;
const testProviderPath = resolve(import.meta.dir, "codex-fast-mode-test-provider.ts");

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("codex-fast-mode extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempProject: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempProject) await rm(tempProject, { recursive: true, force: true });
    tempProject = undefined;
  });

  for (const [model, expectedTier] of [
    ["gpt-5.6", "priority"],
    ["gpt-5.6-sol", "missing"],
    ["gpt-6-astra", "missing"],
  ] as const) {
    test(`uses service_tier=${expectedTier} for ${model} Codex-shaped payloads`, async () => {
      // Arrange
      tempProject = await mkdtemp(join(tmpdir(), "pi-codex-fast-mode-e2e-"));
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
          CODEX_FAST_MODE_TEST_PROVIDER,
          "--model",
          CODEX_FAST_MODE_TEST_MODEL,
        ],
        env: {
          [CODEX_FAST_MODE_TEST_API_KEY_ENV]: "test-key",
          CODEX_FAST_MODE_E2E_PAYLOAD_MODEL: model,
        },
      });

      // Act
      const promptResponse = await harness.request({
        type: "prompt",
        message: "Report the provider payload service tier.",
      });
      const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

      // Assert
      expect(promptResponse.success).toBe(true);
      expect(eventText(agentEnd)).toContain(`service_tier=${expectedTier}`);
      expect(harness.stderr()).toBe("");
    }, 90_000);
  }
});

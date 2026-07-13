import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import {
  PERSONALITY_TEST_API_KEY_ENV,
  PERSONALITY_TEST_MODEL,
  PERSONALITY_TEST_PROVIDERS,
} from "./personality-test-provider";

const PERSONALITY = `You are a pragmatic, effective software engineer.
You take engineering quality seriously and use a direct, factual and
brief communication style with the user without unnecessary detail.`;

const extensionPath = import.meta.dir;
const testProviderPath = resolve(import.meta.dir, "personality-test-provider.ts");
const encodedPersonality = JSON.stringify(PERSONALITY).slice(1, -1);

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("personality extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempProject: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempProject) await rm(tempProject, { recursive: true, force: true });
    tempProject = undefined;
  });

  for (const provider of PERSONALITY_TEST_PROVIDERS) {
    test(`adds the personality prompt for ${provider} models`, async () => {
      // Arrange
      tempProject = await mkdtemp(join(tmpdir(), "pi-personality-e2e-"));
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
          provider,
          "--model",
          PERSONALITY_TEST_MODEL,
        ],
        env: {
          [PERSONALITY_TEST_API_KEY_ENV]: "test-key",
        },
      });

      // Act
      const promptResponse = await harness.request({
        type: "prompt",
        message: "Return the effective system prompt.",
      });
      const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

      // Assert
      expect(promptResponse.success).toBe(true);
      expect(eventText(agentEnd)).toContain(encodedPersonality);
      expect(harness.stderr()).toBe("");
    }, 90_000);
  }
});

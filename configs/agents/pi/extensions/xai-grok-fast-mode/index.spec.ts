import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import {
  XAI_GROK_FAST_MODE_TEST_API_KEY_ENV,
  XAI_GROK_FAST_MODE_TEST_MODEL,
  XAI_GROK_FAST_MODE_TEST_PROVIDER,
} from "./xai-grok-fast-mode-test-provider";

const bundlePath = resolve(import.meta.dir, "..");
const testProviderPath = resolve(import.meta.dir, "xai-grok-fast-mode-test-provider.ts");

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("xai-grok-fast-mode extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempProject: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempProject) await rm(tempProject, { recursive: true, force: true });
    tempProject = undefined;
  });

  test("adds priority processing to direct xAI Grok requests", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-xai-grok-fast-mode-e2e-"));
    harness = await startPiRpcHarness({
      cwd: tempProject,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        bundlePath,
        "-e",
        testProviderPath,
        "--provider",
        XAI_GROK_FAST_MODE_TEST_PROVIDER,
        "--model",
        XAI_GROK_FAST_MODE_TEST_MODEL,
      ],
      env: {
        [XAI_GROK_FAST_MODE_TEST_API_KEY_ENV]: "test-key",
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
    expect(eventText(agentEnd)).toContain("service_tier=priority");
    expect(eventText(agentEnd)).toMatch(/x-grok-conv-id=(?!missing)[^"\\s]+/);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

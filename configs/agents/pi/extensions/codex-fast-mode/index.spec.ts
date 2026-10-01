import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import { CODEX_FAST_MODE_TEST_API_KEY_ENV, CODEX_FAST_MODE_TEST_PROVIDER } from "./codex-fast-mode-test-provider";

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
    ["gpt-6-luna", "priority"],
    ["gpt-5.6-sol", "priority"],
    ["gpt-6-astra", "priority"],
    ["gpt-6.1-sol", "priority"],
  ] as const) {
    test(`uses service_tier=${expectedTier} for ${CODEX_FAST_MODE_TEST_PROVIDER}/${model}`, async () => {
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
          model,
        ],
        env: {
          [CODEX_FAST_MODE_TEST_API_KEY_ENV]: "test-key",
        },
      });

      // Act
      const commands = await harness.request({ type: "get_commands" });
      const offResponse = await harness.request({ type: "prompt", message: "/fast off" });
      await harness.request({ type: "prompt", message: "Report the service tier while fast mode is off." });
      const offEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);
      const offEvents = [...harness.events];
      harness.events.length = 0;
      const onResponse = await harness.request({ type: "prompt", message: "/fast on" });
      const promptResponse = await harness.request({
        type: "prompt",
        message: "Report the provider payload service tier.",
      });
      const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

      // Assert
      expect(JSON.stringify(commands)).toContain('"name":"fast"');
      expect(offResponse.success).toBe(true);
      expect(onResponse.success).toBe(true);
      expect(eventText(offEnd)).toContain("service_tier=missing");
      if (expectedTier === "priority") {
        expect(offEvents).toContainEqual(
          expect.objectContaining({
            method: "setStatus",
            statusKey: "codex-fast-mode",
            statusText: expect.stringContaining("[fast]"),
          }),
        );
        expect(harness.events).toContainEqual(
          expect.objectContaining({
            method: "setStatus",
            statusKey: "codex-fast-mode",
            statusText: expect.stringContaining("[fast]"),
          }),
        );
      }
      expect(promptResponse.success).toBe(true);
      expect(eventText(agentEnd)).toContain(`service_tier=${expectedTier}`);
      expect(harness.stderr()).toBe("");
    }, 90_000);
  }
});

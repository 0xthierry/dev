import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";
import {
  CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT,
  CODEX_COMPACTION_LIFECYCLE_TEST_API_KEY_ENV,
  CODEX_COMPACTION_LIFECYCLE_TEST_MODEL,
  CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER,
  CODEX_COMPACTION_LIFECYCLE_TEST_USAGE_ENV,
} from "./codex-compaction-lifecycle-test-provider";

const testProviderPath = resolve(import.meta.dir, "codex-compaction-lifecycle-test-provider.ts");

type JsonObject = Record<string, unknown>;

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

describe("codex-compaction lifecycle E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempProject: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempProject) await rm(tempProject, { recursive: true, force: true });
    tempProject = undefined;
  });

  test("prevents duplicate compaction when extension and Pi core thresholds overlap", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-codex-compaction-core-e2e-"));
    await mkdir(join(tempProject, ".pi"));
    await writeFile(join(tempProject, ".pi", "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
    await writeFile(join(tempProject, "probe.txt"), "probe content\n");
    harness = await startPiRpcHarness({
      cwd: tempProject,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        testProviderPath,
        "--provider",
        CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER,
        "--model",
        CODEX_COMPACTION_LIFECYCLE_TEST_MODEL,
      ],
      env: {
        [CODEX_COMPACTION_LIFECYCLE_TEST_API_KEY_ENV]: jwtWithAccountId("acct_e2e"),
        [CODEX_COMPACTION_LIFECYCLE_TEST_USAGE_ENV]: "255811",
      },
    });

    // Act
    const promptResponse = await harness.request({ type: "prompt", message: "Read probe.txt, then finish the task." });
    const finalAgentEnd = await harness.waitForEvent(
      (event) => event.type === "agent_end" && eventText(event).includes(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT),
      60_000,
    );

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(finalAgentEnd)).toContain(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT);
    const successfulCompactions = harness.events.filter(
      (event) => event.type === "compaction_end" && event.aborted === false,
    );
    expect(successfulCompactions).toHaveLength(1);
    expect(successfulCompactions[0]?.reason).toBe("manual");
    expect(harness.events.some((event) => event.type === "compaction_end" && event.errorMessage)).toBe(false);
    expect(harness.events.some((event) => eventText(event).includes("codex-compaction-resume"))).toBe(true);
    expect(harness.stderr()).toBe("");
  }, 90_000);

  test("continues a tool-driven agent run after successful early compaction", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-codex-compaction-lifecycle-e2e-"));
    await mkdir(join(tempProject, ".pi"));
    await writeFile(join(tempProject, ".pi", "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
    await writeFile(join(tempProject, "probe.txt"), "probe content\n");
    harness = await startPiRpcHarness({
      cwd: tempProject,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        testProviderPath,
        "--provider",
        CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER,
        "--model",
        CODEX_COMPACTION_LIFECYCLE_TEST_MODEL,
      ],
      env: {
        [CODEX_COMPACTION_LIFECYCLE_TEST_API_KEY_ENV]: jwtWithAccountId("acct_e2e"),
      },
    });

    // Act
    const promptResponse = await harness.request({ type: "prompt", message: "Read probe.txt, then finish the task." });
    const finalAgentEnd = await harness.waitForEvent(
      (event) => event.type === "agent_end" && eventText(event).includes(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT),
      60_000,
    );

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(finalAgentEnd)).toContain(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT);
    expect(harness.events.some((event) => event.type === "compaction_end" && event.aborted === false)).toBe(true);
    expect(harness.events.some((event) => eventText(event).includes("codex-compaction-resume"))).toBe(true);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function jwtWithAccountId(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

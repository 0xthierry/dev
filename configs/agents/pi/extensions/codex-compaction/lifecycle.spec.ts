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
  CODEX_COMPACTION_LIFECYCLE_TEST_SCENARIO_ENV,
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

  test.each([
    { retention: "project", compaction: { reserveTokens: 0, keepRecentTokens: 20_000 } },
    {
      retention: "model override",
      compaction: {
        reserveTokens: 0,
        keepRecentTokens: 1,
        modelOverrides: {
          [`${CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER}/${CODEX_COMPACTION_LIFECYCLE_TEST_MODEL}`]: {
            keepRecentTokens: 20_000,
          },
        },
      },
    },
  ])("does not abort a high-usage tool loop with uncompactable history ($retention retention)", async ({
    compaction,
  }) => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-codex-compaction-small-e2e-"));
    await mkdir(join(tempProject, ".pi"));
    await writeFile(join(tempProject, ".pi", "settings.json"), JSON.stringify({ compaction }));
    harness = await startRegressionHarness(tempProject, "small-history");

    // Act
    const promptResponse = await harness.request({
      type: "prompt",
      message: "Run the exit-code probe, then continue despite its exit code.",
    });
    const end = await harness.waitForEvent((event) => event.type === "agent_end", 15_000);

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(end)).toContain(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT);
    expect(
      harness.events.filter((event) => event.type === "compaction_start" || event.type === "compaction_end"),
    ).toEqual([]);
    expect(harness.events.filter((event) => event.type === "tool_execution_end")).toEqual([
      expect.objectContaining({ toolName: "bash", isError: true }),
    ]);
    expect(eventText(harness.events.find((event) => event.type === "tool_execution_end") ?? {})).toContain("code 2");
    expect(harness.events.some((event) => eventText(event).includes("This operation was aborted"))).toBe(false);
    expect(harness.events.some((event) => eventText(event).includes("codex-compaction-resume"))).toBe(false);
    expect(harness.stderr()).toBe("");
  }, 30_000);

  test("does not compact again when a successful compaction leaves no discardable tail", async () => {
    // Arrange
    tempProject = await mkdtemp(join(tmpdir(), "pi-codex-compaction-tail-e2e-"));
    await mkdir(join(tempProject, ".pi"));
    await writeFile(
      join(tempProject, ".pi", "settings.json"),
      JSON.stringify({ compaction: { reserveTokens: 0, keepRecentTokens: 20_000 } }),
    );
    await writeFile(join(tempProject, "probe.txt"), "probe content\n");
    harness = await startRegressionHarness(tempProject, "post-compaction-small-tail");

    // Act
    const promptResponse = await harness.request({
      type: "prompt",
      message: "Read the probe, then run the exit-code probe and continue.",
    });
    const terminal = await harness.waitForEvent(
      (event) =>
        (event.type === "agent_end" && eventText(event).includes(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT)) ||
        (event.type === "compaction_end" && (event.aborted === true || typeof event.errorMessage === "string")),
      15_000,
    );

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(eventText(terminal)).toContain(CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT);
    expect(harness.events.filter((event) => event.type === "compaction_end")).toEqual([
      expect.objectContaining({ reason: "manual", aborted: false }),
    ]);
    const completedTools = harness.events.filter((event) => event.type === "tool_execution_end");
    expect(completedTools).toEqual([
      expect.objectContaining({ toolName: "read", isError: false }),
      expect.objectContaining({ toolName: "bash", isError: true }),
    ]);
    expect(eventText(completedTools[1] ?? {})).toContain("code 2");
    expect(harness.events.some((event) => eventText(event).includes("Nothing to compact"))).toBe(false);
    expect(harness.stderr()).toBe("");
  }, 30_000);

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

function startRegressionHarness(cwd: string, scenario: "small-history" | "post-compaction-small-tail") {
  return startPiRpcHarness({
    cwd,
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
      [CODEX_COMPACTION_LIFECYCLE_TEST_USAGE_ENV]: "270211",
      [CODEX_COMPACTION_LIFECYCLE_TEST_SCENARIO_ENV]: scenario,
    },
  });
}

function jwtWithAccountId(accountId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

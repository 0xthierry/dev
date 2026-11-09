import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve(import.meta.dir, "index.ts");
const providerConfig = z.object({
  providers: z.object({ cliproxyapi: z.record(z.string(), z.unknown()) }),
});
const assistantText = z.object({ success: z.literal(true), data: z.object({ text: z.string().min(1) }) });
const nativeCompaction = z.object({
  success: z.literal(true),
  data: z.object({
    summary: z.string(),
    details: z.object({
      codexCompaction: z.object({
        version: z.literal(2),
        binding: z.object({
          provider: z.literal("cliproxyapi"),
          api: z.literal("openai-responses"),
          scope: z.literal("proxy"),
          proxyKeyHash: z.string().regex(/^[0-9a-f]{64}$/),
          accountHash: z.never().optional(),
        }),
        artifact: z.array(z.object({ type: z.literal("compaction"), encrypted_content: z.string().min(1) })).length(1),
        userPrefix: z.array(z.unknown()),
      }),
    }),
  }),
});

// Live-provider E2E: requires the normal configured cliproxyapi provider, key and running proxy.
// Uses only a synthetic conversation in an isolated Pi config/session; never compacts the user's session.
describe("CLIProxyAPI native compaction E2E", () => {
  let harness: PiRpcHarness | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  test("recalls assistant-only context after native compaction, process restart and repeated compaction", async () => {
    // Arrange
    const normalAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
    const configured = providerConfig.parse(JSON.parse(await readFile(join(normalAgentDir, "models.json"), "utf8")));
    directory = await mkdtemp(join(tmpdir(), "pi-proxy-compaction-e2e-"));
    const agentDir = join(directory, "agent");
    await mkdir(agentDir);
    await writeFile(join(agentDir, "models.json"), JSON.stringify(configured), { mode: 0o600 });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        packages: [],
        compaction: { enabled: true, keepRecentTokens: 1 },
        defaultProjectTrust: "always",
      }),
    );
    const options = {
      cwd: directory,
      noSession: false,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-tools",
        "-e",
        extensionPath,
        "--provider",
        "cliproxyapi",
        "--model",
        process.env.CODEX_COMPACTION_PROXY_MODEL ?? "gpt-6-astra",
        "--thinking",
        "low",
        "--session",
        join(directory, "session.jsonl"),
      ],
      env: { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" },
    };
    harness = await startPiRpcHarness(options);
    const code = await promptAndRead(
      harness,
      "Invent a project code: one lowercase word, a hyphen, and four digits. Reply with ONLY that code. Remember your chosen code for later questions.",
    );
    await promptAndRead(
      harness,
      "Keep the earlier project code unchanged. Reply with ONLY OK; do not repeat the code.",
    );

    // Act
    const first = nativeCompaction.parse(await harness.request({ type: "compact" }, 180_000));
    const projectedContext = await harness.request({ type: "get_messages" });
    await harness.stop();
    harness = await startPiRpcHarness(options);
    const recalledAfterRestart = await promptAndRead(
      harness,
      "What project code did you choose earlier? Reply with ONLY that exact code.",
    );
    await promptAndRead(harness, "Keep the same project code. Reply with ONLY OK; do not repeat the code.");
    const second = nativeCompaction.parse(await harness.request({ type: "compact" }, 180_000));
    const recalledAfterSecondCompact = await promptAndRead(
      harness,
      "What project code did you originally choose? Reply with ONLY that exact code.",
    );

    // Assert
    expect(code).toMatch(/^[a-z]+-\d{4}$/);
    expect(first.data.summary).toBe(
      "[Opaque Codex compaction artifact — replaced only on compatible Codex provider requests.]",
    );
    expect(first.data.details.codexCompaction.userPrefix).toEqual([]);
    expect(JSON.stringify(projectedContext)).not.toContain(code);
    expect(recalledAfterRestart).toBe(code);
    expect(second.data.summary).toBe(first.data.summary);
    expect(recalledAfterSecondCompact).toBe(code);
    expect(harness.stderr()).toBe("");
  }, 600_000);
});

async function promptAndRead(harness: PiRpcHarness, message: string): Promise<string> {
  const previousEvents = new Set(harness.events);
  const settled = harness.waitForEvent(
    (event) => event.type === "agent_settled" && !previousEvents.has(event),
    120_000,
  );
  const [response] = await Promise.all([harness.request({ type: "prompt", message }), settled]);
  if (response.success !== true) throw new Error("Pi rejected the synthetic compaction-test prompt");
  return assistantText.parse(await harness.request({ type: "get_last_assistant_text" })).data.text.trim();
}

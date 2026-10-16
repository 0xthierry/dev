import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

let root: string | undefined;
let harness: PiRpcHarness | undefined;

afterEach(async () => {
  await harness?.stop();
  if (root) await rm(root, { recursive: true, force: true });
  harness = undefined;
  root = undefined;
});

test("real Pi injects a handoff and captures a prompt using hook-only extension", async () => {
  // Arrange
  root = await mkdtemp(join(tmpdir(), "pi-memory-hooks-e2e-"));
  const log = join(root, "hooks.jsonl");
  await writeFile(join(root, ".ai-memory.toml"), 'workspace = "fixture"\nproject = "native"\n');
  harness = await startPiRpcHarness({
    cwd: root,
    extensionPath: resolve("configs/agents/pi/extensions/ai-memory-pi-tests/fixtures/hook-server.ts"),
    args: [
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-mcp",
      "-e",
      resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts"),
      "--provider",
      FAUX_PROVIDER_NAME,
      "--model",
      FAUX_MODEL_ID,
    ],
    env: {
      PI_CODING_AGENT_DIR: join(root, "agent"),
      AI_MEMORY_DATA_DIR: join(root, "data"),
      AI_MEMORY_RUN_ID: "",
      AI_MEMORY_HOOK_SPEC_LOG: log,
      [FAUX_API_KEY_ENV]: "fixture-key",
      [FAUX_RESPONSE_TEXT_ENV]: "Hook-only run complete.",
    },
  });

  // Act
  await harness.request({ type: "prompt", message: "Remember the isolated fixture." });
  await harness.waitForEvent((event) => event.type === "agent_end");
  const messages = await harness.request({ type: "get_messages" });
  // The vendor queue intentionally drains at 50 ms intervals after an immediate stop.
  await Bun.sleep(250);
  const captured = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

  // Assert
  expect(JSON.stringify(messages)).toContain("Isolated prior-session handoff");
  expect(JSON.stringify(messages)).toContain("Hook-only run complete.");
  expect(captured.map(({ url }) => new URL(url).pathname)).not.toContain("/mcp");
  expect(captured.find(({ url }) => new URL(url).searchParams.get("event") === "user-prompt")?.body).toMatchObject({
    cwd: root,
    prompt: "Remember the isolated fixture.",
    model: "pi-extension-e2e-faux-model",
  });
  expect(
    captured
      .filter(({ url }) => new URL(url).pathname === "/hook")
      .map(({ url }) => new URL(url).searchParams.get("event")),
  ).toEqual(["session-start", "user-prompt", "stop"]);
}, 30_000);

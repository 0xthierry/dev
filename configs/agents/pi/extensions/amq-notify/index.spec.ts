import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = import.meta.dir;
const fauxProviderExtensionPath = resolve(import.meta.dir, "../_shared/testing/faux-provider-extension.ts");
const expectedFinalResponseText = "amq notify e2e complete";

type JsonObject = Record<string, unknown>;

describe("amq-notify extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("injects an incoming AMQ message into a Pi main and acknowledges it", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "amq-notify-e2e-"));
    const debugPath = join(tempDir, "amq-notify.log");
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
        AM_ROOT: "",
        AM_ME: "",
        AMQ_NOTIFY_ROLE: "",
        AMQ_NOTIFY_DEBUG: debugPath,
        AMQ_NO_UPDATE_CHECK: "1",
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedFinalResponseText,
      },
      startupTimeoutMs: 20_000,
    });
    const root = await waitForDebugRoot(debugPath);
    execFileSync("amq", ["init", "--root", root, "--agents", "pi,claude"], { env: amqEnv(root) });

    // Act
    const task = execFileSync(
      "amq",
      [
        "send",
        "--root",
        root,
        "--me",
        "pi",
        "--to",
        "claude",
        "--strict",
        "--kind",
        "todo",
        "--subject",
        "main e2e task",
        "--body",
        "reply when complete",
        "--json",
      ],
      { encoding: "utf8", env: amqEnv(root) },
    );
    const taskId = (JSON.parse(task) as { id: string }).id;
    execFileSync("amq", ["drain", "--root", root, "--me", "claude", "--strict", "--include-body"], {
      env: amqEnv(root),
    });
    execFileSync(
      "amq",
      [
        "reply",
        "--root",
        root,
        "--me",
        "claude",
        "--id",
        taskId,
        "--strict",
        "--kind",
        "status",
        "--labels",
        "done,retire",
        "--subject",
        "complete",
        "--body",
        "hello from e2e",
      ],
      { env: amqEnv(root) },
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);
    const remaining = await waitForNewInbox(root);
    const trace = execFileSync("amq", ["trace", taskId, "--root", root, "--json"], {
      encoding: "utf8",
      env: amqEnv(root),
    });

    // Assert
    const text = eventText(agentEnd);
    expect(text).toContain(expectedFinalResponseText);
    expect(text).toContain("Labels: done,retire");
    expect(trace).toContain("references_target");
    expect(remaining).toEqual([]);
    expect(harness.stderr()).toBe("");
  }, 90_000);

  test("delivers a structured task through a Pi worker's inherited AMQ binding", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "amq-notify-worker-e2e-"));
    const root = join(tempDir, ".agent-mail", "worker-room");
    const debugPath = join(tempDir, "amq-notify-worker.log");
    execFileSync("amq", ["init", "--root", root, "--agents", "main,pi-worker"], { env: amqEnv(root) });
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
        AM_ROOT: root,
        AM_ME: "pi-worker",
        AMQ_NOTIFY_ROLE: "",
        AMQ_NOTIFY_DEBUG: debugPath,
        AMQ_NO_UPDATE_CHECK: "1",
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedFinalResponseText,
      },
      startupTimeoutMs: 20_000,
    });
    await waitForDebugPattern(debugPath, /register role=worker/);

    // Act
    execFileSync(
      "amq",
      [
        "send",
        "--root",
        root,
        "--me",
        "main",
        "--to",
        "pi-worker",
        "--strict",
        "--thread",
        "task/worker-e2e",
        "--kind",
        "todo",
        "--labels",
        "task,role:reviewer",
        "--subject",
        "review worker delivery",
        "--context",
        '{"task_id":"worker-e2e","role":"reviewer","paths":["src/"]}',
        "--body",
        "Review the worker notification path.",
      ],
      { env: amqEnv(root) },
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);
    const remaining = await waitForNewInbox(root, "pi-worker");

    // Assert
    const text = eventText(agentEnd);
    expect(text).toContain(expectedFinalResponseText);
    expect(text).toContain("Handle the assigned task");
    expect(text).toContain("Thread: task/worker-e2e");
    expect(text).toContain('\\"task_id\\":\\"worker-e2e\\"');
    expect(remaining).toEqual([]);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

async function waitForDebugRoot(debugPath: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const text = await readDebugLog(debugPath);
    const match = text.match(/session_start reason=\S+ root=(.*?) me=/);
    if (match?.[1]) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for amq-notify debug root at ${debugPath}`);
}

async function waitForDebugPattern(debugPath: string, pattern: RegExp): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (pattern.test(await readDebugLog(debugPath))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${pattern} in ${debugPath}`);
}

async function readDebugLog(debugPath: string): Promise<string> {
  try {
    return await readFile(debugPath, "utf8");
  } catch {
    return "";
  }
}

async function waitForNewInbox(root: string, me = "pi"): Promise<unknown[]> {
  const deadline = Date.now() + 10_000;
  let messages: unknown[] = [];
  while (Date.now() < deadline) {
    const output = execFileSync("amq", ["list", "--root", root, "--me", me, "--new", "--json"], {
      encoding: "utf8",
      env: amqEnv(root),
    });
    messages = JSON.parse(output) as unknown[];
    if (messages.length === 0) return messages;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return messages;
}

function eventText(event: JsonObject): string {
  return JSON.stringify(event);
}

function amqEnv(root: string): NodeJS.ProcessEnv {
  return { ...process.env, AM_ROOT: root, AMQ_NO_UPDATE_CHECK: "1" };
}

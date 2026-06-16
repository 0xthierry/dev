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

  test("injects an incoming AMQ message into Pi and acknowledges it", async () => {
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
    execFileSync("amq", ["send", "--root", root, "--me", "claude", "--to", "pi", "--body", "hello from e2e"], {
      env: amqEnv(root),
    });
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);
    const remaining = await waitForNewInbox(root);

    // Assert
    expect(eventText(agentEnd)).toContain(expectedFinalResponseText);
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

async function readDebugLog(debugPath: string): Promise<string> {
  try {
    return await readFile(debugPath, "utf8");
  } catch {
    return "";
  }
}

async function waitForNewInbox(root: string): Promise<unknown[]> {
  const deadline = Date.now() + 10_000;
  let messages: unknown[] = [];
  while (Date.now() < deadline) {
    const output = execFileSync("amq", ["list", "--root", root, "--me", "pi", "--new", "--json"], {
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

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = "configs/agents/pi/extensions/blueprint";

type JsonObject = Record<string, unknown>;

describe("blueprint extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("runs a deterministic blueprint through the /blueprint command", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    const blueprintsDir = join(piAgentDir, "blueprints");
    await mkdir(blueprintsDir, { recursive: true });
    await writeFile(join(blueprintsDir, "echo.jsonc"), `${JSON.stringify(echoBlueprint(), null, 2)}\n`, "utf8");

    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: { PI_CODING_AGENT_DIR: piAgentDir },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "/blueprint echo say hello" }, 60_000);
    const messageEvent = await harness.waitForEvent(isBlueprintFinalProgressMessageEnd, 60_000);

    // Assert
    expect(response.success).toBe(true);
    expect(message(messageEvent)?.content).toContain("Blueprint user/echo succeeded");
    expect(message(messageEvent)?.details).toMatchObject({
      blueprint: { id: "user/echo" },
      progress: { status: "succeeded" },
    });
    expect(harness.events.filter(isBlueprintProgressMessageEnd)).toHaveLength(2);
    expect(harness.events.filter(isBlueprintWorkflowWidget)).toHaveLength(0);
    expect(harness.events.filter(isBlueprintStatusSet)).toHaveLength(0);
    expect(harness.events.filter(isBlueprintSuccessNotification)).toHaveLength(0);
    expect(harness.stderr()).toBe("");
  }, 90_000);

  test("records streamed child Pi activity for pi nodes", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-e2e-"));
    const piAgentDir = join(tempDir, "pi-agent");
    const blueprintsDir = join(piAgentDir, "blueprints");
    const fakeBin = join(tempDir, "bin");
    await mkdir(blueprintsDir, { recursive: true });
    await mkdir(fakeBin, { recursive: true });
    await writeFile(join(blueprintsDir, "stream.jsonc"), `${JSON.stringify(piStreamBlueprint(), null, 2)}\n`, "utf8");
    await writeFakeChildPi(join(fakeBin, "pi"));

    harness = await startPiRpcHarness({
      extensionPath,
      args: ["--no-extensions", "--no-skills", "--no-context-files"],
      env: { PI_CODING_AGENT_DIR: piAgentDir, PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
    });

    // Act
    const response = await harness.request(
      { type: "prompt", message: "/blueprint stream show child pi activity" },
      60_000,
    );
    await harness.waitForEvent(isBlueprintFinalProgressMessageEnd, 60_000);
    const runJsonPath = await findRunJson(join(piAgentDir, "blueprint-runs"));
    const runJson = await readFile(runJsonPath, "utf8");

    // Assert
    expect(response.success).toBe(true);
    expect(runJson).toContain('"type": "pi"');
    expect(runJson).toContain('"toolName": "bash"');
    expect(runJson).toContain('"argsPreview": "$ printf child-tool-ok"');
    expect(runJson).toContain('"outputPreview": "child-tool-ok"');
    expect(harness.events.filter(isBlueprintProgressMessageEnd)).toHaveLength(2);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function echoBlueprint() {
  return {
    name: "echo",
    description: "E2E deterministic blueprint",
    start: "echo",
    nodes: {
      echo: { type: "command", run: "printf 'Blueprint E2E deterministic result.'", next: "done" },
      done: { type: "stop", message: "E2E blueprint done." },
    },
  };
}

function piStreamBlueprint() {
  return {
    name: "stream",
    description: "E2E child Pi activity blueprint",
    start: "child",
    nodes: {
      child: { type: "pi", prompt: "Emit deterministic child activity.", tools: ["bash"], next: "done" },
      done: { type: "stop", message: "E2E pi stream done." },
    },
  };
}

async function writeFakeChildPi(filePath: string): Promise<void> {
  await writeFile(
    filePath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'if [[ " $* " == *" --mode json "* ]]; then',
      '  printf \'%s\\n\' \'{"type":"message_update","message":{"role":"assistant","content":[{"type":"text","text":"I am inspecting the task."}]}}\'',
      '  printf \'%s\\n\' \'{"type":"tool_execution_start","toolCallId":"tool-1","toolName":"bash","args":{"command":"printf child-tool-ok"}}\'',
      '  printf \'%s\\n\' \'{"type":"tool_execution_end","toolCallId":"tool-1","toolName":"bash","result":{"content":[{"type":"text","text":"child-tool-ok"}]}}\'',
      '  printf \'%s\\n\' \'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Child Pi completed with streamed tool activity."}],"model":"fake/live","stopReason":"stop"}}\'',
      "  exit 0",
      "fi",
      `exec ${shellQuote(findPiBinary())} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(filePath, 0o755);
}

function findPiBinary(): string {
  const result = spawnSync("which", ["pi"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Unable to find pi binary: ${result.stderr}`);
  return result.stdout.trim();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function findRunJson(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findRunJson(path).catch(() => undefined);
      if (nested) return nested;
    } else if (entry.name === "run.json") {
      return path;
    }
  }
  throw new Error(`run.json not found under ${dir}`);
}

function isBlueprintSuccessNotification(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes("Blueprint user/echo succeeded.")
  );
}

function isBlueprintProgressMessageEnd(event: JsonObject): boolean {
  return event.type === "message_end" && message(event)?.customType === "blueprint-progress";
}

function isBlueprintFinalProgressMessageEnd(event: JsonObject): boolean {
  const details = message(event)?.details;
  const progress = isJsonObject(details) ? details.progress : undefined;
  return isBlueprintProgressMessageEnd(event) && isJsonObject(progress) && progress.status !== "running";
}

function isBlueprintWorkflowWidget(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setWidget" &&
    event.widgetKey === "blueprint" &&
    Array.isArray(event.widgetLines)
  );
}

function isBlueprintStatusSet(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setStatus" &&
    event.statusKey === "blueprint" &&
    typeof event.statusText === "string" &&
    event.statusText.length > 0
  );
}

function message(event: JsonObject): JsonObject | undefined {
  return isJsonObject(event.message) ? event.message : undefined;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object";
}

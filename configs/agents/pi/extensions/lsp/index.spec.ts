import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
  FAUX_TOOL_CALLS_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/lsp");
const fauxProviderExtensionPath = resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts");
const expectedResponseText = "lsp extension e2e complete";

type JsonObject = Record<string, unknown>;

describe("lsp extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("shows status and executes diagnostics through the agent tool loop", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-e2e-"));
    await writeFile(join(tempDir, "sample.ts"), "const value: string = 1;\n", "utf8");
    const fakeBin = await writeFakeLspCommand(tempDir);
    harness = await startPiRpcHarness({
      cwd: tempDir,
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--tools",
        "lsp_diagnostics",
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        PI_LSP_CONFIG: JSON.stringify({ fake: { command: ["fake-lsp"], extensions: [".ts"] } }),
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedResponseText,
        [FAUX_TOOL_CALLS_ENV]: JSON.stringify([
          {
            id: "lsp-diagnostics-fake",
            name: "lsp_diagnostics",
            arguments: { paths: ["sample.ts"], server: "fake", limit: 1 },
          },
        ]),
      },
    });

    // Act
    const commandResponse = await harness.request({ type: "prompt", message: "/lsp" });
    const notifyEvent = await harness.waitForEvent(isLspNotifyEvent, 30_000);
    const promptResponse = await harness.request({ type: "prompt", message: "Run fake LSP diagnostics." });
    const toolEnd = await harness.waitForEvent(
      (event) => event.type === "tool_execution_end" && event.toolName === "lsp_diagnostics",
      60_000,
    );
    const agentEnd = await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Assert
    expect(commandResponse.success).toBe(true);
    expect(notifyEvent.message).toContain("fake LSP command: fake-lsp");
    expect(notifyEvent.message).toContain("fake status: ready");
    expect(promptResponse.success).toBe(true);
    expect(JSON.stringify(toolEnd)).toContain("sample.ts:1:23: error fake-lsp E100: Fake diagnostic from LSP");
    expect(JSON.stringify(agentEnd)).toContain(expectedResponseText);
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

async function writeFakeLspCommand(directory: string): Promise<string> {
  const bin = join(directory, "bin");
  await mkdir(bin);
  const commandPath = join(bin, "fake-lsp");
  await writeFile(commandPath, fakeLspScript(), "utf8");
  await chmod(commandPath, 0o755);
  return bin;
}

function fakeLspScript(): string {
  return `#!/usr/bin/env node
let buffer = Buffer.alloc(0);
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
}
function diagnostic() {
  return {
    range: { start: { line: 0, character: 22 }, end: { line: 0, character: 23 } },
    severity: 1,
    source: 'fake-lsp',
    code: 'E100',
    message: 'Fake diagnostic from LSP'
  };
}
function handle(message) {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { capabilities: { textDocumentSync: 1, diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } } } });
    return;
  }
  if (message.method === 'textDocument/diagnostic') {
    send({ jsonrpc: '2.0', id: message.id, result: { kind: 'full', items: [diagnostic()] } });
    return;
  }
  if (message.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: message.id, result: null });
    process.exit(0);
  }
  if (Object.prototype.hasOwnProperty.call(message, 'id')) {
    send({ jsonrpc: '2.0', id: message.id, result: null });
  }
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf('\\r\\n\\r\\n');
    if (separator < 0) return;
    const header = buffer.subarray(0, separator).toString('utf8');
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) throw new Error('Missing Content-Length');
    const bodyStart = separator + 4;
    const length = Number(match[1]);
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
    buffer = buffer.subarray(bodyStart + length);
    handle(JSON.parse(body));
  }
});
`;
}

function isLspNotifyEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    typeof event.message === "string" &&
    event.message.includes("fake LSP command")
  );
}

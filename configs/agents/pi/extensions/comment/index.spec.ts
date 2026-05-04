import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = "configs/agents/pi/extensions/comment";
const fauxProviderExtensionPath = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";
const assistantResponse = "Comment e2e assistant response.\nSecond line.";

type JsonObject = Record<string, unknown>;

describe("comment extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("loads an externally edited quote of the last assistant response through Pi RPC", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-comment-e2e-"));
    const editorPath = await writeEditorScript(tempDir);
    harness = await startPiRpcHarness({
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "-e",
        fauxProviderExtensionPath,
        "--provider",
        FAUX_PROVIDER_NAME,
        "--model",
        FAUX_MODEL_ID,
      ],
      env: {
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: assistantResponse,
        VISUAL: editorPath,
        EDITOR: "",
      },
    });

    const promptResponse = await harness.request({
      type: "prompt",
      message: "Reply with the configured faux response.",
    });
    await harness.waitForEvent((event) => event.type === "agent_end", 60_000);

    // Act
    const commandResponse = await harness.request({ type: "prompt", message: "/comment" });
    const editorTextEvent = await harness.waitForEvent(isSetEditorTextEvent, 30_000);
    const notifyEvent = await harness.waitForEvent(isSuccessNotificationEvent, 30_000);

    // Assert
    expect(promptResponse.success).toBe(true);
    expect(commandResponse.success).toBe(true);
    expect(editorTextEvent.text).toBe(
      "Reviewed assistant response:\n\n> Comment e2e assistant response.\n> Second line.",
    );
    expect(notifyEvent.message).toBe("Loaded edited quoted assistant text into the editor.");
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

async function writeEditorScript(directory: string): Promise<string> {
  const editorPath = join(directory, "editor.sh");
  await writeFile(
    editorPath,
    [
      "#!/bin/sh",
      "set -eu",
      'target="$1"',
      'tmp="$target.edited"',
      "{",
      "  printf 'Reviewed assistant response:\\n\\n'",
      '  cat "$target"',
      '} > "$tmp"',
      'mv "$tmp" "$target"',
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(editorPath, 0o755);
  return editorPath;
}

function isSetEditorTextEvent(event: JsonObject): boolean {
  return event.type === "extension_ui_request" && event.method === "set_editor_text" && typeof event.text === "string";
}

function isSuccessNotificationEvent(event: JsonObject): boolean {
  return (
    event.type === "extension_ui_request" &&
    event.method === "notify" &&
    event.message === "Loaded edited quoted assistant text into the editor."
  );
}

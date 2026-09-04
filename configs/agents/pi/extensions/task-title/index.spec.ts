import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/task-title");
const fauxProviderExtensionPath = resolve("configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts");

type JsonObject = Record<string, unknown>;

describe("task-title extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("publishes the active prompt as Pi's terminal title", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-task-title-e2e-"));
    harness = await startPiRpcHarness({
      cwd: tempDir,
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
        HOME: tempDir,
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: "Task-title E2E response.",
      },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "Fix the title shown in Omarchy" });
    const titleEvent = await harness.waitForEvent(isTaskTitleEvent, 30_000);
    await harness.waitForEvent((event) => event.type === "agent_settled", 60_000);

    // Assert
    expect(response.success).toBe(true);
    expect(titleEvent.title).toBe("π · Fix the title shown in Omarchy");
    expect(harness.stderr()).toBe("");
  }, 90_000);
});

function isTaskTitleEvent(event: JsonObject): event is JsonObject & { title: string } {
  return (
    event.type === "extension_ui_request" &&
    event.method === "setTitle" &&
    typeof event.title === "string" &&
    event.title.startsWith("π · ")
  );
}

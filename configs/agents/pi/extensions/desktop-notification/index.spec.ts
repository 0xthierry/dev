import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  FAUX_API_KEY_ENV,
  FAUX_MODEL_ID,
  FAUX_PROVIDER_NAME,
  FAUX_RESPONSE_TEXT_ENV,
} from "../_shared/testing/faux-provider-extension";

const expectedResponseText = "Desktop notification e2e complete.";
const extensionPath = "configs/agents/pi/extensions/desktop-notification";
const fauxProviderExtensionPath = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";

describe("desktop-notification extension E2E", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("sends an OSC 777 notification after the agent finishes", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-desktop-notification-e2e-"));
    const transcriptPath = join(tempDir, "typescript");
    const command = buildShellCommand([
      "pi",
      "--mode",
      "json",
      "--no-session",
      "-e",
      resolve(extensionPath),
      "-e",
      resolve(fauxProviderExtensionPath),
      "--provider",
      FAUX_PROVIDER_NAME,
      "--model",
      FAUX_MODEL_ID,
      "Reply with the configured faux response.",
    ]);

    // Act
    const process = Bun.spawn(["script", "-qfec", command, transcriptPath], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...Bun.env,
        [FAUX_API_KEY_ENV]: "test-key",
        [FAUX_RESPONSE_TEXT_ENV]: expectedResponseText,
      },
    });
    const [exitCode, stderr] = await Promise.all([process.exited, new Response(process.stderr).text()]);
    const transcript = await readFile(transcriptPath, "utf8");

    // Assert
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(transcript).toContain(`\x1b]777;notify;π;${expectedResponseText}\x07`);
    expect(transcript).toContain('"type":"agent_end"');
  }, 60_000);
});

function buildShellCommand(args: string[]): string {
  return args.map(shellQuote).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

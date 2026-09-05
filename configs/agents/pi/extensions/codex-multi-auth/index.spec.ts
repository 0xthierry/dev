import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = resolve("configs/agents/pi/extensions/codex-multi-auth");
let harness: PiRpcHarness | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  await harness?.stop();
  harness = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("codex-multi-auth extension E2E", () => {
  test("reports an active authenticated multi-account route inside Pi", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-codex-multi-auth-e2e-"));
    const storagePath = join(tempDir, "openai-codex-accounts.json");
    await writeFile(
      storagePath,
      `${JSON.stringify({
        version: 3,
        accounts: [
          {
            accountId: "test-account",
            accountIdSource: "manual",
            email: "test@example.invalid",
            refreshToken: "test-refresh-token",
            accessToken: "test-access-token",
            expiresAt: Date.now() + 60_000,
            addedAt: Date.now(),
            lastUsed: Date.now(),
          },
        ],
        activeIndex: 0,
        activeIndexByFamily: { codex: 0 },
      })}\n`,
      { mode: 0o600 },
    );
    await chmod(tempDir, 0o700);
    harness = await startPiRpcHarness({
      cwd: tempDir,
      extensionPath,
      args: [
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--provider",
        "openai-codex",
        "--model",
        "gpt-5.6-sol",
      ],
      env: { HOME: tempDir, CODEX_MULTI_AUTH_DIR: tempDir },
    });

    // Act
    const response = await harness.request({ type: "prompt", message: "/codex-multi-auth-status" });
    const notification = await harness.waitForEvent(
      (event) =>
        event.type === "extension_ui_request" &&
        event.method === "notify" &&
        typeof event.message === "string" &&
        event.message.includes("Codex multi-account routing"),
    );

    // Assert
    expect(response.success).toBe(true);
    expect(notification).toMatchObject({
      method: "notify",
      message: "Codex multi-account routing is active · 1 account",
      notifyType: "info",
    });
    expect(harness.stderr()).toBe("");
  }, 30_000);
});

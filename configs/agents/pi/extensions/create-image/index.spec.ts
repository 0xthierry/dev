import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PiRpcHarness, startPiRpcHarness } from "../_shared/testing/pi-rpc-harness";

const extensionPath = "configs/agents/pi/extensions/create-image";

type JsonObject = Record<string, unknown>;

describe("create-image extension E2E", () => {
  let harness: PiRpcHarness | undefined;
  let tempDir: string | undefined;

  afterEach(async () => {
    await harness?.stop();
    harness = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("executes the create-image command through Pi RPC", async () => {
    // Arrange
    harness = await startCreateImageHarness();

    // Act
    const response = await harness.request({
      type: "prompt",
      message: "/create-image --provider missing a tiny fox logo",
    });
    const messageEnd = await harness.waitForEvent(isCreateImageMessageEnd, 30_000);

    // Assert
    expect(response.success).toBe(true);
    expect(messageContent(messageEnd)).toContain("Unknown image provider: missing");
    expect(messageDetails(messageEnd)).toMatchObject({ ok: false });
    expect(harness.stderr()).toBe("");
  }, 60_000);

  test("generates and saves an image through the command when live Gemini Web access is enabled", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-create-image-e2e-"));
    harness = await startCreateImageHarness();

    // Act
    const response = await harness.request(
      {
        type: "prompt",
        message:
          `/create-image --out ${tempDir} --name e2e-image ` +
          "Generate one small square image of a single red circle centered on a plain white background. Use Nano Banana image generation. Do not send web images.",
      },
      30_000,
    );
    const messageEnd = await harness.waitForEvent(isSuccessfulCreateImageMessageEnd, 240_000);
    const savedFile = firstSavedFile(messageEnd);
    const bytes = await readFile(savedFile.path);

    // Assert
    expect(response.success).toBe(true);
    expect(messageContent(messageEnd)).toContain("Created 1 image(s) with Nano Banana.");
    expect(savedFile.path).toStartWith(tempDir);
    expect(savedFile.mimeType).toMatch(/^image\//);
    expect(bytes.length).toBeGreaterThan(1000);
    expect(isRecognizedImage(bytes)).toBe(true);
    expect(harness.stderr()).toBe("");
  }, 300_000);
});

function startCreateImageHarness(): Promise<PiRpcHarness> {
  return startPiRpcHarness({
    extensionPath,
    args: ["--no-extensions", "--no-skills", "--no-context-files"],
  });
}

function isCreateImageMessageEnd(event: JsonObject): boolean {
  return event.type === "message_end" && message(event)?.customType === "create-image-result";
}

function isSuccessfulCreateImageMessageEnd(event: JsonObject): boolean {
  return isCreateImageMessageEnd(event) && messageDetails(event)?.ok === true;
}

function message(event: JsonObject): JsonObject | undefined {
  const value = event.message;
  return value && typeof value === "object" ? (value as JsonObject) : undefined;
}

function messageContent(event: JsonObject): string {
  const content = message(event)?.content;
  return typeof content === "string" ? content : "";
}

function messageDetails(event: JsonObject): JsonObject | undefined {
  const details = message(event)?.details;
  return details && typeof details === "object" ? (details as JsonObject) : undefined;
}

function firstSavedFile(event: JsonObject): { path: string; mimeType: string } {
  const files = messageDetails(event)?.files;
  if (!Array.isArray(files)) throw new Error("Expected create-image details.files array.");
  const first = files[0];
  if (!first || typeof first !== "object") throw new Error("Expected at least one saved image.");
  const path = (first as JsonObject).path;
  const mimeType = (first as JsonObject).mimeType;
  if (typeof path !== "string" || typeof mimeType !== "string")
    throw new Error("Expected saved image path and MIME type.");
  return { path, mimeType };
}

function isRecognizedImage(bytes: Uint8Array): boolean {
  return isJpeg(bytes) || isPng(bytes) || isWebp(bytes);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

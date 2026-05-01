import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildImageFileName, sanitizeFileStem, saveGeneratedImages } from "./files";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("sanitizeFileStem", () => {
  test("turns prompts into safe lowercase file stems", () => {
    // Arrange
    const value = "  Café fox logo!!!  ";

    // Act
    const stem = sanitizeFileStem(value);

    // Assert
    expect(stem).toBe("cafe-fox-logo");
  });
});

describe("buildImageFileName", () => {
  test("uses timestamps, provider ids, prompt slugs, and image indexes", () => {
    // Arrange
    const now = new Date("2026-05-01T17:30:04Z");

    // Act
    const fileName = buildImageFileName({
      prompt: "Red circle",
      providerId: "nano-banana",
      now,
      index: 1,
      total: 2,
      extension: "jpg",
    });

    // Assert
    expect(fileName).toBe("20260501-173004-nano-banana-red-circle-2.jpg");
  });
});

describe("saveGeneratedImages", () => {
  test("writes generated images and returns display paths", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-create-image-files-"));
    const bytes = new Uint8Array([1, 2, 3]);

    // Act
    const saved = await saveGeneratedImages([{ bytes, mimeType: "image/jpeg", extension: "jpg" }], {
      cwd: tempDir,
      outputDir: "images",
      fileName: "demo.png",
      prompt: "ignored prompt",
      providerId: "nano-banana",
      now: new Date("2026-05-01T17:30:04Z"),
    });

    // Assert
    expect(saved).toEqual([
      {
        path: join(tempDir, "images", "20260501-173004-nano-banana-demo.jpg"),
        displayPath: "images/20260501-173004-nano-banana-demo.jpg",
        mimeType: "image/jpeg",
        bytes: 3,
      },
    ]);
    const firstSaved = saved[0];
    expect(firstSaved).toBeDefined();
    if (!firstSaved) throw new Error("Expected a saved image.");
    expect(await readFile(firstSaved.path)).toEqual(Buffer.from(bytes));
  });
});

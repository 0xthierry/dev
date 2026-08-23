import { afterEach, describe, expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { type PiContentResult, toPiContent } from "./content";

const spillDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(spillDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("toPiContent", () => {
  test("preserves text and images when output is below Pi's limit", async () => {
    // Arrange
    const input = [
      { type: "text", text: "state" },
      { type: "image", data: "png-data", mimeType: "image/png" },
    ] satisfies PiContentResult["content"];

    // Act
    const rendered = await toPiContent(input);

    // Assert
    expect(rendered.content).toEqual(input);
    expect(rendered.fullOutputPath).toBeUndefined();
  });

  test("truncates aggregate text to a private spill file without spilling images", async () => {
    // Arrange
    const first = "x".repeat(30 * 1024);
    const second = "y".repeat(30 * 1024);
    const original = `${first}\n\n${second}`;

    // Act
    const rendered = await toPiContent([
      { type: "text", text: first },
      { type: "image", data: "first-image", mimeType: "image/png" },
      { type: "text", text: second },
      { type: "image", data: "second-image", mimeType: "image/png" },
    ]);
    if (!rendered.fullOutputPath) throw new Error("Expected truncated content to have a spill path");
    spillDirectories.push(path.dirname(rendered.fullOutputPath));
    const spill = await readFile(rendered.fullOutputPath, "utf8");
    const spillMode = (await stat(rendered.fullOutputPath)).mode & 0o777;

    // Assert
    expect(spill).toBe(original);
    expect(spillMode).toBe(0o600);
    expect(rendered.content.map((block) => block.type)).toEqual(["text", "image", "text", "image"]);
    expect(rendered.content[1]).toEqual({ type: "image", data: "first-image", mimeType: "image/png" });
    expect(rendered.content[2]?.type === "text" ? rendered.content[2].text : "").toMatch(
      /Official Computer Use text truncated:.*Full output saved to:/s,
    );
    expect(rendered.content[3]).toEqual({ type: "image", data: "second-image", mimeType: "image/png" });
  });
});

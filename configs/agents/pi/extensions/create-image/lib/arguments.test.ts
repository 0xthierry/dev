import { describe, expect, test } from "bun:test";
import { getCreateImageArgumentCompletions, parseCreateImageArgs, tokenizeArgs } from "./arguments";

describe("tokenizeArgs", () => {
  test("keeps quoted prompt fragments together", () => {
    // Arrange
    const input = "--out assets 'a red fox' \"with blue eyes\"";

    // Act
    const tokens = tokenizeArgs(input);

    // Assert
    expect(tokens).toEqual(["--out", "assets", "a red fox", "with blue eyes"]);
  });
});

describe("getCreateImageArgumentCompletions", () => {
  test("suggests prompt starters and command options for empty arguments", () => {
    // Act
    const completions = getCreateImageArgumentCompletions("");

    // Assert
    expect(completions).toContainEqual(
      expect.objectContaining({ value: "generate an image of ", label: "generate an image of" }),
    );
    expect(completions).toContainEqual(expect.objectContaining({ value: "--out generated-images ", label: "--out" }));
  });

  test("preserves previous arguments when completing options", () => {
    // Act
    const completions = getCreateImageArgumentCompletions("--out assets --n");

    // Assert
    expect(completions).toEqual([expect.objectContaining({ value: "--out assets --name image ", label: "--name" })]);
  });

  test("completes provider values from registered providers", () => {
    // Arrange
    const providers = [
      { id: "nano-banana", aliases: ["gemini"], label: "Nano Banana", generate: async () => undefined },
    ];

    // Act
    const completions = getCreateImageArgumentCompletions("--provider g", providers as never);

    // Assert
    expect(completions).toEqual([expect.objectContaining({ value: "--provider gemini ", label: "gemini" })]);
  });

  test("completes inline option values", () => {
    // Act
    const completions = getCreateImageArgumentCompletions("--out=gen");

    // Assert
    expect(completions).toEqual([
      expect.objectContaining({ value: "--out=generated-images ", label: "generated-images" }),
    ]);
  });
});

describe("parseCreateImageArgs", () => {
  test("parses options and prompt", () => {
    // Arrange
    const input = "--provider gemini --out assets --name fox --profile Default a tiny fox logo";

    // Act
    const result = parseCreateImageArgs(input);

    // Assert
    expect(result).toEqual({
      ok: true,
      args: {
        help: false,
        provider: "gemini",
        outputDir: "assets",
        fileName: "fox",
        profile: "Default",
        prompt: "a tiny fox logo",
      },
    });
  });

  test("supports equals options and -- prompt separator", () => {
    // Arrange
    const input = "--out=assets -- --not-an-option image prompt";

    // Act
    const result = parseCreateImageArgs(input);

    // Assert
    expect(result).toEqual({
      ok: true,
      args: { help: false, outputDir: "assets", prompt: "--not-an-option image prompt" },
    });
  });

  test("returns usage errors for unknown options", () => {
    // Arrange
    const input = "--bad prompt";

    // Act
    const result = parseCreateImageArgs(input);

    // Assert
    expect(result).toMatchObject({ ok: false, error: "Unknown option: --bad." });
  });
});

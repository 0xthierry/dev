import { describe, expect, test } from "bun:test";
import { parseCreateImageArgs, tokenizeArgs } from "./arguments";

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

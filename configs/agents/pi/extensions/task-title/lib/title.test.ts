import { describe, expect, test } from "bun:test";
import { formatTaskTitle } from "./title";

describe("formatTaskTitle", () => {
  test("turns a prompt into a compact Pi task title", () => {
    // Arrange
    const prompt = "  fix the Herdr title\nwithout changing Ghostty  ";

    // Act
    const title = formatTaskTitle(prompt);

    // Assert
    expect(title).toBe("π · fix the Herdr title without changing Ghostty");
  });

  test("removes skill prefixes, attachment markup, and terminal controls", () => {
    // Arrange
    const prompt = "/skill:use-agent  # Review\u001b]0;unsafe\u0007 <image_files>secret.png</image_files> now";

    // Act
    const title = formatTaskTitle(prompt);

    // Assert
    expect(title).toBe("π · Review ]0;unsafe now");
  });

  test("clips long prompts without splitting Unicode characters", () => {
    // Arrange
    const prompt = "🧪".repeat(80);

    // Act
    const title = formatTaskTitle(prompt);

    // Assert
    expect(title).toBe(`π · ${"🧪".repeat(71)}…`);
  });

  test("does not create an empty title", () => {
    // Arrange
    const prompt = "\n\t <image_files>shot.png</image_files> ";

    // Act
    const title = formatTaskTitle(prompt);

    // Assert
    expect(title).toBeUndefined();
  });
});

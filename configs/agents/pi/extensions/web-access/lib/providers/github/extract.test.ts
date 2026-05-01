import { describe, expect, test } from "bun:test";
import { extractGitHub } from "./extract";

describe("extractGitHub", () => {
  test("returns guidance for full SHA URLs without cloning", async () => {
    // Arrange
    const url = "https://github.com/owner/repo/tree/0123456789abcdef0123456789abcdef01234567/src";

    // Act
    const result = await extractGitHub(url);

    // Assert
    expect(result?.provider).toBe("github");
    expect(result?.content).toContain("Commit SHA GitHub URLs are not cloneable");
  });
});

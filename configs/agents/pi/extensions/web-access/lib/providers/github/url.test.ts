import { describe, expect, test } from "bun:test";
import { gitHubCacheKey, parseGitHubUrl } from "./url";

describe("parseGitHubUrl", () => {
  test("parses repository roots", () => {
    // Arrange
    const url = "https://github.com/owner/repo";

    // Act
    const result = parseGitHubUrl(url);

    // Assert
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      type: "root",
      refIsFullSha: false,
    });
  });

  test("parses blob URLs", () => {
    // Arrange
    const url = "https://github.com/owner/repo/blob/main/src/index.ts";

    // Act
    const result = parseGitHubUrl(url);

    // Assert
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      type: "blob",
      ref: "main",
      refIsFullSha: false,
      path: "src/index.ts",
    });
  });

  test("parses full SHA refs", () => {
    // Arrange
    const url = "https://github.com/owner/repo/tree/0123456789abcdef0123456789abcdef01234567/src";

    // Act
    const result = parseGitHubUrl(url);

    // Assert
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      type: "tree",
      ref: "0123456789abcdef0123456789abcdef01234567",
      refIsFullSha: true,
      path: "src",
    });
  });

  test("ignores non-code GitHub sections", () => {
    // Arrange
    const url = "https://github.com/owner/repo/issues/1";

    // Act
    const result = parseGitHubUrl(url);

    // Assert
    expect(result).toBeNull();
  });
});

describe("gitHubCacheKey", () => {
  test("includes refs only when present", () => {
    // Arrange
    const root = { owner: "owner", repo: "repo", type: "root" as const, refIsFullSha: false };
    const branch = { ...root, ref: "main" };

    // Act
    const rootKey = gitHubCacheKey(root);
    const branchKey = gitHubCacheKey(branch);

    // Assert
    expect(rootKey).toBe("owner/repo");
    expect(branchKey).toBe("owner/repo@main");
  });
});

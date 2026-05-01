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

  test("rejects encoded traversal in clone path segments", () => {
    // Arrange
    const urls = [
      "https://github.com/%2e%2e/repo",
      "https://github.com/owner/%2e%2e",
      "https://github.com/owner/repo%2f..",
      "https://github.com/owner/repo/tree/%2e%2e/src",
    ];

    // Act / Assert
    for (const url of urls) expect(parseGitHubUrl(url)).toBeNull();
  });

  test("rejects traversal in content path segments", () => {
    // Arrange
    const url = "https://github.com/owner/repo/blob/main/src%2f..%2fpackage.json";

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

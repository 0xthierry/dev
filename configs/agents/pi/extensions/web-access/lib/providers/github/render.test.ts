import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGitHubContent } from "./render";
import type { GitHubUrlInfo } from "./url";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function makeRepo(): string {
  tempDir = mkdtempSync(join(tmpdir(), "pi-web-github-render-"));
  return tempDir;
}

describe("buildGitHubContent", () => {
  test("renders repository trees with README content", () => {
    // Arrange
    const repoPath = makeRepo();
    mkdirSync(join(repoPath, "src"));
    writeFileSync(join(repoPath, "src", "index.ts"), "export const value = 1;\n");
    writeFileSync(join(repoPath, "README.md"), "# Example Repo\n\nRead me.\n");
    const info: GitHubUrlInfo = { owner: "owner", repo: "repo", type: "root", refIsFullSha: false };

    // Act
    const content = buildGitHubContent(repoPath, info);

    // Assert
    expect(content.startsWith("## Structure")).toBe(true);
    expect(content).toContain("src/");
    expect(content).toContain("src/index.ts");
    expect(content).toContain("# Example Repo");
    expect(content.indexOf("# Example Repo")).toBeLessThan(content.indexOf(`Repository cloned to: ${repoPath}`));
  });

  test("renders blob content for text files", () => {
    // Arrange
    const repoPath = makeRepo();
    writeFileSync(join(repoPath, "file.txt"), "hello file\n");
    const info: GitHubUrlInfo = {
      owner: "owner",
      repo: "repo",
      type: "blob",
      ref: "main",
      path: "file.txt",
      refIsFullSha: false,
    };

    // Act
    const content = buildGitHubContent(repoPath, info);

    // Assert
    expect(content.startsWith("## file.txt")).toBe(true);
    expect(content).toContain("hello file");
    expect(content.indexOf("hello file")).toBeLessThan(content.indexOf(`Repository cloned to: ${repoPath}`));
  });

  test("does not follow blob paths outside the repository", () => {
    // Arrange
    const repoPath = makeRepo();
    const info: GitHubUrlInfo = {
      owner: "owner",
      repo: "repo",
      type: "blob",
      ref: "main",
      path: "../secret.txt",
      refIsFullSha: false,
    };

    // Act
    const content = buildGitHubContent(repoPath, info);

    // Assert
    expect(content).toContain("## Structure");
    expect(content).not.toContain("## ../secret.txt");
  });
});

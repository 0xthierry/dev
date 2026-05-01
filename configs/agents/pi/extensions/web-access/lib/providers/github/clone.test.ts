import { describe, expect, test } from "bun:test";
import { buildCloneDir, normalizeGitHubConfig } from "./clone";

describe("normalizeGitHubConfig", () => {
  test("uses defaults for missing or invalid config values", () => {
    // Arrange
    const raw = { enabled: "yes", maxRepoSizeMB: -1, cloneTimeoutSeconds: 0, clonePath: " " };

    // Act
    const config = normalizeGitHubConfig(raw);

    // Assert
    expect(config).toEqual({
      enabled: true,
      maxRepoSizeMB: 350,
      cloneTimeoutSeconds: 30,
      clonePath: "/tmp/pi-github-repos",
    });
  });

  test("normalizes valid config values", () => {
    // Arrange
    const raw = { enabled: false, maxRepoSizeMB: 42, cloneTimeoutSeconds: 9, clonePath: " /tmp/repos " };

    // Act
    const config = normalizeGitHubConfig(raw);

    // Assert
    expect(config).toEqual({
      enabled: false,
      maxRepoSizeMB: 42,
      cloneTimeoutSeconds: 9,
      clonePath: "/tmp/repos",
    });
  });
});

describe("buildCloneDir", () => {
  test("keeps repository paths inside the configured clone root", () => {
    // Arrange
    const cfg = normalizeGitHubConfig({ clonePath: "/tmp/pi-github-repos" });
    const info = { owner: "owner", repo: "repo", type: "root" as const, refIsFullSha: false };

    // Act
    const result = buildCloneDir(cfg, info);

    // Assert
    expect(result).toBe("/tmp/pi-github-repos/owner/repo");
  });

  test("rejects repository paths that would escape the clone root", () => {
    // Arrange
    const cfg = normalizeGitHubConfig({ clonePath: "/tmp/pi-github-repos" });
    const info = { owner: "..", repo: "outside", type: "root" as const, refIsFullSha: false };

    // Act
    const result = buildCloneDir(cfg, info);

    // Assert
    expect(result).toBeNull();
  });
});

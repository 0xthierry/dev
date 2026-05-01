import { describe, expect, test } from "bun:test";
import { normalizeGitHubConfig } from "./clone";

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

import { describe, expect, test } from "bun:test";
import {
  artifactIdFromReference,
  artifactReference,
  encodeProjectPath,
  getPrivateArtifactDirectory,
  getProjectArtifactDirectory,
  getProjectSessionDirectory,
} from "./paths";

describe("subagent runtime paths", () => {
  test("builds stable project-scoped session and artifact directories", () => {
    // Arrange
    const cwd = "/home/test/project with spaces";
    const agentDir = "/home/test/.pi/agent";

    // Act
    const project = encodeProjectPath(cwd);
    const sessions = getProjectSessionDirectory(cwd, agentDir);
    const artifacts = getProjectArtifactDirectory(cwd, agentDir);

    // Assert
    expect(project).toBe("--home-test-project-with-spaces--");
    expect(sessions).toBe(`${agentDir}/subagent-sessions/${project}`);
    expect(artifacts).toBe(`${agentDir}/subagent-artifacts/${project}`);
  });

  test("round-trips stable references without exposing private paths", () => {
    // Arrange
    const artifactId = "0123456789abcdef0123456789abcdef";

    // Act
    const reference = artifactReference(artifactId);
    const decoded = artifactIdFromReference(reference);
    const privateDirectory = getPrivateArtifactDirectory("/repo", artifactId, "/agent");

    // Assert
    expect(reference).toBe(`subagent-artifact:${artifactId}`);
    expect(reference).not.toContain("/agent");
    expect(decoded).toBe(artifactId);
    expect(privateDirectory).toBe(`/agent/subagent-artifacts/--repo--/${artifactId}`);
  });

  test("rejects malformed artifact references", () => {
    // Arrange
    const references = ["subagent-artifact:../secret", "artifact:0123", "subagent-artifact:short"];

    // Act
    const ids = references.map(artifactIdFromReference);

    // Assert
    expect(ids).toEqual([undefined, undefined, undefined]);
  });
});

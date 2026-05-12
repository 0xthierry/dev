import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAgentOutputArtifactPath, getAgentSessionArtifactDir, saveAgentOutputArtifact } from "./artifacts";

describe("agent output artifacts", () => {
  test("builds artifact paths under the Pi agent directory by child session id", () => {
    // Arrange
    const agentDir = "/home/test/.pi/agent";
    const sessionId = "019e1882-8bc8-767c-a1e6-d7c9ebd3a574";
    const now = new Date("2026-05-12T10:20:30.400Z");

    // Act
    const dir = getAgentSessionArtifactDir(sessionId, agentDir);
    const path = getAgentOutputArtifactPath({ sessionId, agentName: "code/scout", agentDir, now });

    // Assert
    expect(dir).toBe(`${agentDir}/agent-sessions-artifacts/${sessionId}/artifacts`);
    expect(path).toBe(`${dir}/2026-05-12T10-20-30-400Z_code-scout_output.md`);
  });

  test("writes child output artifacts", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-artifacts-"));
    const sessionId = "019e1882-8bc8-767c-a1e6-d7c9ebd3a574";
    const output = "Full child output.";

    try {
      // Act
      const result = await saveAgentOutputArtifact({
        sessionId,
        agentName: "explorer",
        output,
        agentDir,
        now: new Date("2026-05-12T10:20:30.400Z"),
      });

      // Assert
      expect(result).toEqual({
        ok: true,
        path: join(
          agentDir,
          "agent-sessions-artifacts",
          sessionId,
          "artifacts",
          "2026-05-12T10-20-30-400Z_explorer_output.md",
        ),
      });
      if (result.ok && result.path) {
        expect(await readFile(result.path, "utf8")).toBe(output);
      }
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("skips artifact writes until a child session id is known", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-artifacts-"));

    try {
      // Act
      const result = await saveAgentOutputArtifact({ agentName: "explorer", output: "output", agentDir });

      // Assert
      expect(result).toEqual({ ok: true });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});

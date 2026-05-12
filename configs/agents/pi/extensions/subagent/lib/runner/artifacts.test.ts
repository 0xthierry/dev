import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createAgentArtifactPlan,
  finalizeAgentRunArtifacts,
  getAgentArtifactPaths,
  getAgentOutputArtifactPath,
  getAgentSessionArtifactDir,
  writeAgentInputArtifact,
} from "./artifacts";

describe("agent run artifacts", () => {
  test("builds Nico-style artifact paths under the Pi agent directory by child session id", () => {
    // Arrange
    const agentDir = "/home/test/.pi/agent";
    const sessionId = "019e1882-8bc8-767c-a1e6-d7c9ebd3a574";
    const now = new Date("2026-05-12T10:20:30.400Z");

    // Act
    const dir = getAgentSessionArtifactDir(sessionId, agentDir);
    const paths = getAgentArtifactPaths({ sessionId, agentName: "code/scout", agentDir, now });

    // Assert
    expect(dir).toBe(`${agentDir}/agent-sessions-artifacts/${sessionId}/artifacts`);
    expect(paths).toEqual({
      inputPath: `${dir}/2026-05-12T10-20-30-400Z_code-scout_input.md`,
      outputPath: `${dir}/2026-05-12T10-20-30-400Z_code-scout_output.md`,
      jsonlPath: `${dir}/2026-05-12T10-20-30-400Z_code-scout.jsonl`,
      metadataPath: `${dir}/2026-05-12T10-20-30-400Z_code-scout_meta.json`,
    });
    expect(getAgentOutputArtifactPath({ sessionId, agentName: "code/scout", agentDir, now })).toBe(paths.outputPath);
  });

  test("finalizes detailed child-authored output into the real child session artifact directory", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-artifacts-"));
    const pendingPlan = createAgentArtifactPlan({
      agentName: "explorer",
      agentDir,
      now: new Date("2026-05-12T10:20:30.400Z"),
    });
    await writeAgentInputArtifact(pendingPlan, "# Input\n\nTask details");
    await writeFile(pendingPlan.paths.outputPath, "Detailed child-authored report.", "utf8");

    try {
      // Act
      const result = await finalizeAgentRunArtifacts(pendingPlan, {
        sessionId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
        fallbackOutput: "Short final response.",
        jsonlLines: ['{"type":"session"}', '{"type":"message_end"}'],
        metadata: { agent: "explorer", exitCode: 0 },
      });

      // Assert
      expect(result).toMatchObject({ ok: true, output: "Detailed child-authored report.", usedChildOutputFile: true });
      if (result.ok) {
        expect(result.paths.outputPath).toBe(
          join(
            agentDir,
            "agent-sessions-artifacts",
            "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
            "artifacts",
            "2026-05-12T10-20-30-400Z_explorer_output.md",
          ),
        );
        expect(await readFile(result.paths.inputPath, "utf8")).toBe("# Input\n\nTask details");
        expect(await readFile(result.paths.outputPath, "utf8")).toBe("Detailed child-authored report.");
        expect(await readFile(result.paths.jsonlPath, "utf8")).toBe('{"type":"session"}\n{"type":"message_end"}\n');
        const metadata = JSON.parse(await readFile(result.paths.metadataPath, "utf8")) as Record<string, unknown>;
        expect(metadata).toMatchObject({
          agent: "explorer",
          exitCode: 0,
          artifactSessionId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
          usedChildOutputFile: true,
          outputBytes: 31,
          outputLines: 1,
        });
      }
      await expect(readdir(dirname(dirname(pendingPlan.paths.outputPath)))).rejects.toThrow();
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("falls back to final assistant output when the child does not write the artifact", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "pi-agent-artifacts-"));
    const plan = createAgentArtifactPlan({
      sessionId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
      agentName: "worker",
      agentDir,
      now: new Date("2026-05-12T10:20:30.400Z"),
    });
    await writeAgentInputArtifact(plan, "# Input");

    try {
      // Act
      const result = await finalizeAgentRunArtifacts(plan, {
        fallbackOutput: "Fallback assistant output.",
        jsonlLines: [],
        metadata: { agent: "worker", exitCode: 0 },
      });

      // Assert
      expect(result).toMatchObject({ ok: true, output: "Fallback assistant output.", usedChildOutputFile: false });
      if (result.ok) {
        expect(await readFile(result.paths.outputPath, "utf8")).toBe("Fallback assistant output.");
      }
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});

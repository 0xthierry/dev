import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectCwd, findAgentSessionFileById, getProjectAgentSessionDir } from "./paths";

describe("getProjectAgentSessionDir", () => {
  test("mirrors Pi session organization under an agent-sessions namespace", () => {
    // Arrange
    const cwd = "/home/thierry/dev";
    const agentDir = "/home/thierry/.pi/agent";

    // Act
    const dir = getProjectAgentSessionDir(cwd, agentDir);

    // Assert
    expect(dir).toBe("/home/thierry/.pi/agent/agent-sessions/--home-thierry-dev--");
  });
});

describe("encodeProjectCwd", () => {
  test("normalizes a project cwd into a stable directory name", () => {
    // Arrange
    const cwd = "/tmp/project with spaces/app";

    // Act
    const encoded = encodeProjectCwd(cwd);

    // Assert
    expect(encoded).toBe("--tmp-project-with-spaces-app--");
  });
});

describe("findAgentSessionFileById", () => {
  test("finds a session file by full id or unique prefix", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-subagent-sessions-"));
    const sessionFile = join(dir, "2026-05-11T00-00-00-000Z_019e1882-8bc8-767c-a1e6-d7c9ebd3a574.jsonl");
    await writeFile(
      sessionFile,
      '{"type":"session","version":3,"id":"019e1882-8bc8-767c-a1e6-d7c9ebd3a574","timestamp":"now","cwd":"/repo"}\n',
      "utf8",
    );

    // Act
    const result = await findAgentSessionFileById(dir, "019e1882");

    // Assert
    expect(result).toEqual({
      ok: true,
      match: { sessionId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574", sessionFile },
    });
  });

  test("reports ambiguous prefixes", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-subagent-sessions-"));
    await mkdir(dir, { recursive: true });
    await writeSession(dir, "019e1882-aaaa-7000-8000-000000000001");
    await writeSession(dir, "019e1882-bbbb-7000-8000-000000000002");

    // Act
    const result = await findAgentSessionFileById(dir, "019e1882");

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous");
      expect(result.matches).toHaveLength(2);
    }
  });
});

async function writeSession(dir: string, id: string): Promise<void> {
  const file = join(dir, `session_${id}.jsonl`);
  await writeFile(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: "now", cwd: "/repo" })}\n`);
}

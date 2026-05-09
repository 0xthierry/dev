import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverAgentsContextForTarget,
  discoverAgentsSession,
  findProjectRoot,
  normalizeInputPath,
} from "./discovery";

describe("nested agents context discovery", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("discovers target context files in parent-to-child order", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-nested-agents-discovery-"));
    await mkdir(join(tempDir, ".git"));
    await mkdir(join(tempDir, "tests", "unit"), { recursive: true });
    await writeFile(join(tempDir, "AGENTS.md"), "Root instructions.");
    await writeFile(join(tempDir, "tests", "AGENTS.md"), "Test instructions.");
    await writeFile(join(tempDir, "tests", "unit", "CLAUDE.md"), "Unit instructions.");
    const session = await discoverAgentsSession(tempDir);

    // Act
    const result = await discoverAgentsContextForTarget(session, tempDir, {
      path: "tests/unit/example.test.ts",
      kind: "file",
    });

    // Assert
    expect(session.projectRoot).toBe(tempDir);
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "AGENTS.md",
      "tests/AGENTS.md",
      "tests/unit/CLAUDE.md",
    ]);
    expect(result.files.map((file) => file.content)).toEqual([
      "Root instructions.",
      "Test instructions.",
      "Unit instructions.",
    ]);
  });

  test("uses AGENTS.md before CLAUDE.md when both exist in the same directory", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-nested-agents-precedence-"));
    await mkdir(join(tempDir, ".git"));
    await mkdir(join(tempDir, "pkg"), { recursive: true });
    await writeFile(join(tempDir, "pkg", "AGENTS.md"), "Agents wins.");
    await writeFile(join(tempDir, "pkg", "CLAUDE.md"), "Claude loses.");
    const session = await discoverAgentsSession(tempDir);

    // Act
    const result = await discoverAgentsContextForTarget(session, tempDir, { path: "pkg/file.ts", kind: "file" });

    // Assert
    expect(result.files.map((file) => [file.relativePath, file.content])).toEqual([["pkg/AGENTS.md", "Agents wins."]]);
  });

  test("deduplicates symlinked context files by real path", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-nested-agents-symlink-"));
    await mkdir(join(tempDir, ".git"));
    await mkdir(join(tempDir, "shared"), { recursive: true });
    await mkdir(join(tempDir, "pkg"), { recursive: true });
    await writeFile(join(tempDir, "shared", "AGENTS.md"), "Shared instructions.");
    await symlink(join(tempDir, "shared", "AGENTS.md"), join(tempDir, "AGENTS.md"));
    await symlink(join(tempDir, "shared", "AGENTS.md"), join(tempDir, "pkg", "AGENTS.md"));
    const session = await discoverAgentsSession(tempDir);

    // Act
    const result = await discoverAgentsContextForTarget(session, tempDir, { path: "pkg/file.ts", kind: "file" });

    // Assert
    expect(result.files.map((file) => file.relativePath)).toEqual(["AGENTS.md"]);
    expect(result.files.map((file) => file.content)).toEqual(["Shared instructions."]);
  });

  test("does not discover context for paths outside the project root", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-nested-agents-outside-"));
    await mkdir(join(tempDir, ".git"));
    await writeFile(join(tempDir, "AGENTS.md"), "Root instructions.");
    const session = await discoverAgentsSession(tempDir);

    // Act
    const result = await discoverAgentsContextForTarget(session, tempDir, { path: "../outside/file.ts", kind: "file" });

    // Assert
    expect(result.files).toEqual([]);
  });

  test("normalizes decorated paths", () => {
    // Arrange
    const path = "@src/app.ts:12:3,";

    // Act
    const result = normalizeInputPath(path);

    // Assert
    expect(result).toBe("src/app.ts");
  });
});

describe("findProjectRoot", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("finds the nearest git root", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-nested-agents-root-"));
    await mkdir(join(tempDir, ".git"));
    await mkdir(join(tempDir, "packages", "web"), { recursive: true });

    // Act
    const result = findProjectRoot(join(tempDir, "packages", "web"));

    // Assert
    expect(result).toBe(tempDir);
  });
});

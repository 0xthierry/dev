import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFffDbPathResolver, createProjectDbPaths, findProjectRoot, projectCacheKey } from "./db-paths";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("findProjectRoot", () => {
  test("uses the nearest git root", () => {
    // Arrange
    const dir = createTempDir();
    const repo = join(dir, "repo");
    const nested = join(repo, "packages", "app");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    // Act
    const root = findProjectRoot(nested);

    // Assert
    expect(root).toBe(repo);
  });

  test("treats git worktree files as project markers", () => {
    // Arrange
    const dir = createTempDir();
    const worktree = join(dir, "worktree");
    const nested = join(worktree, "src");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(worktree, ".git"), "gitdir: /tmp/repo/.git/worktrees/worktree\n");

    // Act
    const root = findProjectRoot(nested);

    // Assert
    expect(root).toBe(worktree);
  });
});

describe("createProjectDbPaths", () => {
  test("creates stable project-scoped frecency and history paths", () => {
    // Arrange
    const dir = createTempDir();
    const cacheHome = join(dir, "cache");
    const repo = join(dir, "repo");
    const nested = join(repo, "src");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(nested, { recursive: true });

    // Act
    const paths = createProjectDbPaths(nested, cacheHome);

    // Assert
    const projectDir = join(cacheHome, "pi", "fff", "projects", projectCacheKey(repo));
    expect(paths).toEqual({
      frecencyDbPath: join(projectDir, "frecency.sqlite"),
      historyDbPath: join(projectDir, "history.sqlite"),
    });
  });
});

describe("createFffDbPathResolver", () => {
  test("shares cache paths within a project and separates different projects", () => {
    // Arrange
    const dir = createTempDir();
    const cacheHome = join(dir, "cache");
    const firstRepo = createRepo(dir, "repo");
    const secondRepo = createRepo(dir, "other-repo");
    const resolveDbPaths = createFffDbPathResolver({ cacheHome });

    // Act
    const firstPaths = resolveDbPaths(join(firstRepo, "src"));
    const siblingPaths = resolveDbPaths(join(firstRepo, "tests"));
    const secondPaths = resolveDbPaths(secondRepo);

    // Assert
    expect(siblingPaths).toEqual(firstPaths);
    expect(secondPaths.frecencyDbPath).not.toBe(firstPaths.frecencyDbPath);
    expect(secondPaths.historyDbPath).not.toBe(firstPaths.historyDbPath);
  });

  test("keeps explicit database path overrides", () => {
    // Arrange
    const dir = createTempDir();
    const repo = createRepo(dir, "repo");
    const resolveDbPaths = createFffDbPathResolver({
      cacheHome: join(dir, "cache"),
      frecencyDbPathOverride: "/custom/frecency",
      historyDbPathOverride: "/custom/history",
    });

    // Act
    const paths = resolveDbPaths(repo);

    // Assert
    expect(paths).toEqual({
      frecencyDbPath: "/custom/frecency",
      historyDbPath: "/custom/history",
    });
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-fff-db-paths-"));
  tempDirs.push(dir);
  return dir;
}

function createRepo(parent: string, name: string): string {
  const repo = join(parent, name);
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "tests"), { recursive: true });
  return repo;
}

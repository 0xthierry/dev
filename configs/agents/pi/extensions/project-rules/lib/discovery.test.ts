import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjectRules, findProjectRoot } from "./discovery";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function makeTempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-project-rules-"));
  tempDirs.push(dir);
  await mkdir(join(dir, ".git"));
  return dir;
}

describe("discoverProjectRules", () => {
  test("discovers rules from supported directories in deterministic order", async () => {
    // Arrange
    const root = await makeTempProject();
    await mkdir(join(root, ".pi", "rules"), { recursive: true });
    await mkdir(join(root, ".agents", "rules"), { recursive: true });
    await writeFile(join(root, ".pi", "rules", "testing.md"), "# Testing\nRun tests.");
    await writeFile(join(root, ".agents", "rules", "api.md"), "# API\nValidate input.");

    // Act
    const result = await discoverProjectRules(root);

    // Assert
    expect(result.projectRoot).toBe(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.rules.map((rule) => rule.relativePath)).toEqual([".pi/rules/testing.md", ".agents/rules/api.md"]);
    expect(result.rules.map((rule) => rule.mode)).toEqual(["always", "always"]);
  });

  test("deduplicates symlinked rule files by their real path", async () => {
    // Arrange
    const root = await makeTempProject();
    await mkdir(join(root, ".claude", "rules"), { recursive: true });
    await mkdir(join(root, ".agents", "rules"), { recursive: true });
    const target = join(root, ".claude", "rules", "testing.md");
    await writeFile(target, "# Testing\nRun tests.");
    await symlink(target, join(root, ".agents", "rules", "testing.md"));

    // Act
    const result = await discoverProjectRules(root);

    // Assert
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]?.aliases.sort()).toEqual([".agents/rules/testing.md", ".claude/rules/testing.md"]);
  });

  test("normalizes nested rule patterns to project-root-relative paths", async () => {
    // Arrange
    const root = await makeTempProject();
    const child = join(root, "packages", "app");
    await mkdir(join(child, ".pi", "rules"), { recursive: true });
    await writeFile(join(child, ".pi", "rules", "app.md"), '---\npaths:\n  - "src/**/*.ts"\n---\nUse app conventions.');

    // Act
    const result = await discoverProjectRules(child);

    // Assert
    expect(result.rules[0]?.relativePath).toBe("packages/app/.pi/rules/app.md");
    expect(result.rules[0]?.patterns).toEqual(["packages/app/src/**/*.ts"]);
  });

  test("loads ancestor rules up to the git root", async () => {
    // Arrange
    const root = await makeTempProject();
    const child = join(root, "packages", "app");
    await mkdir(join(root, ".pi", "rules"), { recursive: true });
    await mkdir(join(child, ".pi", "rules"), { recursive: true });
    await writeFile(join(root, ".pi", "rules", "root.md"), "root");
    await writeFile(join(child, ".pi", "rules", "child.md"), "child");

    // Act
    const result = await discoverProjectRules(child);

    // Assert
    expect(findProjectRoot(child)).toBe(root);
    expect(result.projectRoot).toBe(root);
    expect(result.rules.map((rule) => rule.relativePath)).toEqual([
      ".pi/rules/root.md",
      "packages/app/.pi/rules/child.md",
    ]);
  });
});

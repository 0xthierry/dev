import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultProjectBlueprintDirs, defaultUserBlueprintDirs, discoverBlueprints } from "./discovery";

const finalBlueprint = (name: string) =>
  JSON.stringify({ name, description: `${name} description`, nodes: { done: { type: "final" } } });

describe("discoverBlueprints", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("loads user and project blueprints from JSON files and directories", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-discovery-"));
    const userDir = join(tempDir, "user-blueprints");
    const projectDir = join(tempDir, "repo", ".pi", "blueprint");
    await mkdir(join(userDir, "nested"), { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(userDir, "user.json"), finalBlueprint("user-flow"), "utf8");
    await writeFile(join(userDir, "nested", "blueprint.json"), finalBlueprint("nested-flow"), "utf8");
    await writeFile(join(projectDir, "project.json"), finalBlueprint("project-flow"), "utf8");

    // Act
    const result = await discoverBlueprints(join(tempDir, "repo"), { userDirs: [userDir], projectDirs: [projectDir] });

    // Assert
    expect(result.errors).toEqual([]);
    expect(result.blueprints.map((blueprint) => blueprint.id)).toEqual([
      "project/project-flow",
      "user/nested-flow",
      "user/user-flow",
    ]);
    expect(result.blueprints.find((blueprint) => blueprint.id === "project/project-flow")?.scope).toBe("project");
  });

  test("keeps sibling ~/.pi/blueprint directories scoped as user blueprints", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-discovery-"));
    const siblingUserDir = join(tempDir, ".pi", "blueprint");
    await mkdir(siblingUserDir, { recursive: true });
    await writeFile(join(siblingUserDir, "personal.json"), finalBlueprint("personal"), "utf8");

    // Act
    const result = await discoverBlueprints(tempDir, { userDirs: [siblingUserDir], projectDirs: [] });

    // Assert
    expect(result.blueprints.map((blueprint) => blueprint.id)).toEqual(["user/personal"]);
  });

  test("reports invalid definitions without blocking valid blueprints", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-discovery-"));
    const userDir = join(tempDir, "blueprints");
    await mkdir(userDir, { recursive: true });
    await writeFile(join(userDir, "valid.json"), finalBlueprint("valid"), "utf8");
    await writeFile(join(userDir, "broken.json"), "{", "utf8");

    // Act
    const result = await discoverBlueprints(tempDir, { userDirs: [userDir], projectDirs: [] });

    // Assert
    expect(result.blueprints.map((blueprint) => blueprint.id)).toEqual(["user/valid"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain("Invalid JSON");
  });
});

describe("default blueprint directories", () => {
  test("uses Pi agent and sibling Pi blueprint directories for user blueprints", () => {
    // Arrange
    const agentDir = "/home/me/.pi/agent";

    // Act
    const dirs = defaultUserBlueprintDirs(agentDir);

    // Assert
    expect(dirs).toEqual(["/home/me/.pi/agent/blueprints", "/home/me/.pi/blueprint", "/home/me/.pi/blueprints"]);
  });

  test("finds nearest project blueprint directories", async () => {
    // Arrange
    const tempDir = await mkdtemp(join(tmpdir(), "pi-blueprint-project-dirs-"));
    const nested = join(tempDir, "repo", "packages", "app");
    await mkdir(join(tempDir, "repo", ".pi", "blueprints"), { recursive: true });
    await mkdir(nested, { recursive: true });

    try {
      // Act
      const dirs = defaultProjectBlueprintDirs(nested);

      // Assert
      expect(dirs).toContain(join(tempDir, "repo", ".pi", "blueprints"));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

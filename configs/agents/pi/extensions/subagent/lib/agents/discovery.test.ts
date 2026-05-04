import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverUserAgents } from "./discovery";

describe("discoverUserAgents", () => {
  test("loads markdown agents with required frontmatter recursively", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    await mkdir(join(dir, "nested"));
    await writeFile(
      join(dir, "reviewer.md"),
      ["---", "name: reviewer", "description: Reviews code", "model: opus", "---", "Review carefully."].join("\n"),
      "utf8",
    );
    await writeFile(
      join(dir, "nested", "locator.md"),
      ["---", "name: locator", "description: Finds files", "---", "Locate relevant files."].join("\n"),
      "utf8",
    );
    await writeFile(join(dir, "notes.md"), "No frontmatter", "utf8");
    await writeFile(join(dir, "broken.md"), "---\nname: [unterminated\n---\nBroken", "utf8");

    try {
      // Act
      const result = await discoverUserAgents({ agentsDir: dir });

      // Assert
      expect(result.agentsDir).toBe(dir);
      expect(result.agents.map((agent) => agent.name)).toEqual(["locator", "reviewer"]);
      expect(result.agents[0]).toMatchObject({ description: "Finds files", source: "user" });
      expect(result.agents[1].systemPrompt).toBe("Review carefully.");
      expect(result.agents[1].frontmatter.model).toBe("opus");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("keeps the first discovered agent when names collide", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    await writeFile(join(dir, "a.md"), "---\nname: duplicate\ndescription: First\n---\nFirst body", "utf8");
    await writeFile(join(dir, "b.md"), "---\nname: duplicate\ndescription: Second\n---\nSecond body", "utf8");

    try {
      // Act
      const result = await discoverUserAgents({ agentsDir: dir });

      // Assert
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].description).toBe("First");
      expect(result.agents[0].systemPrompt).toBe("First body");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

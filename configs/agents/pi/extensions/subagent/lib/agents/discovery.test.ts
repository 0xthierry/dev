import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents, discoverUserAgents } from "./discovery";

describe("discoverUserAgents", () => {
  test("loads markdown agents with required frontmatter recursively", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    await mkdir(join(dir, "nested"));
    await writeFile(
      join(dir, "reviewer.md"),
      [
        "---",
        "name: reviewer",
        "description: Reviews code",
        "model: opus",
        "effort: medium",
        "---",
        "Review carefully.",
      ].join("\n"),
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
      expect(result.agents[1].effort).toBe("medium");
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

describe("discoverAgents", () => {
  test("adds built-in agents after user discovery", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    await writeFile(
      join(dir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\n---\nReview body",
      "utf8",
    );

    try {
      // Act
      const result = await discoverAgents({ agentsDir: dir });

      // Assert
      expect(result.agents.map((agent) => agent.name)).toEqual(["explorer", "reviewer", "worker"]);
      expect(result.agents.find((agent) => agent.name === "explorer")).toMatchObject({
        source: "builtin",
        effort: "medium",
      });
      expect(result.agents.find((agent) => agent.name === "worker")).toMatchObject({
        source: "builtin",
        effort: "xhigh",
      });
      expect(result.agents.find((agent) => agent.name === "worker")?.systemPrompt).toContain("bounded implementation");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lets user agents override built-in agents with the same name", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    await writeFile(
      join(dir, "explorer.md"),
      "---\nname: explorer\ndescription: Custom explorer\n---\nCustom body",
      "utf8",
    );

    try {
      // Act
      const result = await discoverAgents({ agentsDir: dir });

      // Assert
      const explorer = result.agents.find((agent) => agent.name === "explorer");
      expect(explorer).toMatchObject({ source: "user", description: "Custom explorer", systemPrompt: "Custom body" });
      expect(result.agents.map((agent) => agent.name)).toEqual(["explorer", "worker"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

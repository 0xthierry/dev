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

  test("loads project .pi agents before global agents when cwd is provided", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    const repo = join(dir, "repo");
    const cwd = join(repo, "apps", "web");
    const projectAgentsDir = join(repo, ".pi", "agents");
    const globalAgentsDir = join(dir, "global-agents");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(projectAgentsDir, { recursive: true });
    await mkdir(globalAgentsDir, { recursive: true });
    await writeFile(
      join(projectAgentsDir, "project-only.md"),
      "---\nname: project-only\ndescription: Project agent\n---\nProject body",
      "utf8",
    );
    await writeFile(
      join(projectAgentsDir, "shared.md"),
      "---\nname: shared\ndescription: Project shared\n---\nProject shared body",
      "utf8",
    );
    await writeFile(
      join(globalAgentsDir, "global-only.md"),
      "---\nname: global-only\ndescription: Global agent\n---\nGlobal body",
      "utf8",
    );
    await writeFile(
      join(globalAgentsDir, "shared.md"),
      "---\nname: shared\ndescription: Global shared\n---\nGlobal shared body",
      "utf8",
    );

    try {
      // Act
      const result = await discoverUserAgents({ agentsDir: globalAgentsDir, cwd });

      // Assert
      expect(result.agentDirs).toEqual([projectAgentsDir, globalAgentsDir]);
      expect(result.agents.map((agent) => agent.name)).toEqual(["global-only", "project-only", "shared"]);
      expect(result.agents.find((agent) => agent.name === "shared")).toMatchObject({
        description: "Project shared",
        systemPrompt: "Project shared body",
      });
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
      expect(result.agents.map((agent) => agent.name)).toEqual(["reviewer", "scout", "worker"]);
      expect(result.agents.find((agent) => agent.name === "scout")).toMatchObject({
        source: "builtin",
        effort: "low",
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
    await writeFile(join(dir, "scout.md"), "---\nname: scout\ndescription: Custom scout\n---\nCustom body", "utf8");

    try {
      // Act
      const result = await discoverAgents({ agentsDir: dir });

      // Assert
      const scout = result.agents.find((agent) => agent.name === "scout");
      expect(scout).toMatchObject({ source: "user", description: "Custom scout", systemPrompt: "Custom body" });
      expect(result.agents.map((agent) => agent.name)).toEqual(["scout", "worker"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("lets a project .pi/agents agent override the built-in of the same name", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-agent-discovery-"));
    const repo = join(dir, "repo");
    const cwd = join(repo, "apps", "web");
    const projectAgentsDir = join(repo, ".pi", "agents");
    const globalAgentsDir = join(dir, "global-agents");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(cwd, { recursive: true });
    await mkdir(projectAgentsDir, { recursive: true });
    await mkdir(globalAgentsDir, { recursive: true });
    await writeFile(
      join(projectAgentsDir, "scout.md"),
      "---\nname: scout\ndescription: Repo scout\neffort: high\n---\nRepo scout body",
      "utf8",
    );

    try {
      // Act
      const result = await discoverAgents({ agentsDir: globalAgentsDir, cwd });

      // Assert: the repo scout fully replaces the built-in scout (exactly one, sourced from the repo)
      const scouts = result.agents.filter((agent) => agent.name === "scout");
      expect(scouts).toHaveLength(1);
      expect(scouts[0]).toMatchObject({
        source: "user",
        description: "Repo scout",
        systemPrompt: "Repo scout body",
        effort: "high",
      });
      expect(result.agents.find((agent) => agent.name === "worker")?.source).toBe("builtin");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents, readAgentDirectory } from "./discovery";

describe("discoverAgents", () => {
  test("loads trusted project and global definitions in deterministic order with stable paths", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    const repo = join(root, "repo");
    const global = join(root, "global");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".pi", "agents"), { recursive: true });
    await mkdir(global, { recursive: true });
    await writeFile(join(global, "zeta.md"), "---\nname: zeta\ndescription: Zeta\n---\nZ prompt", "utf8");
    await writeFile(
      join(repo, ".pi", "agents", "alpha.md"),
      "---\nname: alpha\ndescription: Alpha\n---\nA prompt",
      "utf8",
    );

    try {
      // Act
      const result = await discoverAgents({ projectRoot: repo, projectTrusted: true, globalAgentsDir: global });

      // Assert
      expect(result.agents.map((agent) => agent.name)).toEqual(["alpha", "scout", "worker", "zeta"]);
      expect(result.agents.find((agent) => agent.name === "alpha")?.sourcePath).toBe(".pi/agents/alpha.md");
      expect(result.agents.find((agent) => agent.name === "zeta")?.sourcePath).toBe("global://zeta.md");
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("lets a trusted project definition override the same global role", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    const repo = join(root, "repo");
    const global = join(root, "global");
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(join(repo, ".pi", "agents"), { recursive: true });
    await mkdir(global, { recursive: true });
    await writeFile(
      join(repo, ".pi", "agents", "codebase-analyzer.md"),
      "---\nname: codebase-analyzer\ndescription: Project analyzer\n---\nProject instructions",
    );
    await writeFile(
      join(global, "codebase-analyzer.md"),
      "---\nname: codebase-analyzer\ndescription: Global analyzer\n---\nGlobal instructions",
    );

    try {
      // Act
      const result = await discoverAgents({ projectRoot: repo, projectTrusted: true, globalAgentsDir: global });

      // Assert
      const analyzer = result.agents.find((agent) => agent.name === "codebase-analyzer");
      expect(analyzer).toMatchObject({
        description: "Project analyzer",
        systemPrompt: "Project instructions",
        sourcePath: ".pi/agents/codebase-analyzer.md",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not inspect project definitions or config when untrusted", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    await mkdir(join(root, ".pi", "agents"), { recursive: true });
    await writeFile(join(root, ".pi", "agents", "bad.md"), "malformed", "utf8");
    await writeFile(join(root, "pi-subagent.json"), "malformed", "utf8");

    try {
      // Act
      const result = await discoverAgents({ projectRoot: root, projectTrusted: false });

      // Assert
      expect(result.agents.map((agent) => agent.name)).toEqual(["scout", "worker"]);
      expect(result.repositoryConfig).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads trusted definitions larger than the retired file cap", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    const global = join(root, "global");
    const instructions = "x".repeat(1024 * 1024 + 1);
    await mkdir(global, { recursive: true });
    await writeFile(join(global, "large.md"), `---\nname: large\ndescription: Large\n---\n${instructions}`);

    try {
      // Act
      const agents = await readAgentDirectory(global, "global");

      // Assert
      expect(agents[0]?.systemPrompt).toBe(instructions);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("loads trusted catalogs larger than the retired lifetime cap", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    const global = join(root, "global");
    await mkdir(global, { recursive: true });
    await Promise.all(
      Array.from({ length: 101 }, (_, index) =>
        writeFile(
          join(global, `agent-${String(index).padStart(3, "0")}.md`),
          `---\nname: agent-${index}\ndescription: Agent ${index}\n---\nPrompt`,
        ),
      ),
    );

    try {
      // Act
      const agents = await readAgentDirectory(global, "global");

      // Assert
      expect(agents).toHaveLength(101);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports unknown configured agents with a typed path-aware config error", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    await mkdir(join(root, ".git"), { recursive: true });
    await writeFile(
      join(root, "pi-subagent.json"),
      JSON.stringify({ agents: { ghost: { allowInvocationOverride: { model: true } } } }),
      "utf8",
    );

    try {
      // Act
      const discovery = discoverAgents({ projectRoot: root, projectTrusted: true });

      // Assert
      await expect(discovery).rejects.toMatchObject({
        kind: "invalid_repository_config",
        configPath: "pi-subagent.json",
      });
      await expect(discovery).rejects.toThrow("configures unknown agents: ghost");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects duplicate definitions instead of silently choosing one", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-discovery-"));
    const global = join(root, "global");
    await mkdir(global, { recursive: true });
    await writeFile(join(global, "a.md"), "---\nname: duplicate\ndescription: A\n---\nA", "utf8");
    await writeFile(join(global, "b.md"), "---\nname: duplicate\ndescription: B\n---\nB", "utf8");

    try {
      // Act
      const discovery = discoverAgents({ projectTrusted: false, globalAgentsDir: global });

      // Assert
      await expect(discovery).rejects.toMatchObject({ kind: "duplicate_agent", agentName: "duplicate" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

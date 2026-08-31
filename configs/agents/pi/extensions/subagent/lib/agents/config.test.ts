import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executionPolicyForAgent, loadRepositorySubagentConfig, parseRepositorySubagentConfig } from "./config";

describe("parseRepositorySubagentConfig", () => {
  test("parses the documented nested repository schema", () => {
    // Arrange
    const value = {
      runtime: { maxActiveAgents: 4, maxResidentAgents: 8, maxDepth: 3 },
      agents: {
        worker: {
          execution: { provider: "openai-codex", model: "gpt-5.4", effort: "max" },
          allowInvocationOverride: { model: true, effort: false },
        },
      },
    };

    // Act
    const result = parseRepositorySubagentConfig(value);

    // Assert
    expect(result.runtime).toEqual({ maxActiveAgents: 4, maxResidentAgents: 8, maxDepth: 3 });
    expect(result.agents.get("worker")).toEqual({
      execution: { provider: "openai-codex", model: "gpt-5.4", effort: "max" },
      allowInvocationOverride: { model: true, effort: false },
    });
    expect(executionPolicyForAgent(result, "worker")).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4",
      effort: "max",
      allowInvocationOverride: { model: true, effort: false },
    });
  });

  test("accepts the legacy flat execution schema and ignores unrelated trusted fields", () => {
    // Arrange
    const value = {
      secret: true,
      agents: {
        worker: {
          provider: "openai-codex",
          model: "gpt-5.4",
          effort: "high",
          temperature: 0,
        },
      },
    };

    // Act
    const result = parseRepositorySubagentConfig(value);

    // Assert
    expect(result.agents.get("worker")).toEqual({
      execution: { provider: "openai-codex", model: "gpt-5.4", effort: "high" },
      allowInvocationOverride: { model: true, effort: true },
    });
  });

  test("still rejects an incomplete explicitly configured model", () => {
    // Arrange
    const incomplete = { agents: { worker: { execution: { provider: "xai" } } } };

    // Act
    const parseIncomplete = () => parseRepositorySubagentConfig(incomplete);

    // Assert
    expect(parseIncomplete).toThrow("provider and agents.worker.execution.model must be specified together");
  });

  test("does not impose runtime-cap limits on trusted policy catalogs or identifiers", () => {
    // Arrange
    const agents: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [`agent-${index}`, { allowInvocationOverride: { model: true } }]),
    );
    const longName = "n".repeat(8 * 1024);
    const longProvider = "p".repeat(8 * 1024);
    agents[longName] = { execution: { provider: longProvider, model: "model" } };

    // Act
    const result = parseRepositorySubagentConfig({ agents });

    // Assert
    expect(result.agents.size).toBe(102);
    expect(result.agents.get(longName)?.execution?.provider).toBe(longProvider);
  });

  test("accepts trusted runtime budgets above the retired supervisor caps", () => {
    // Arrange
    const value = { runtime: { maxActiveAgents: 160, maxResidentAgents: 320, maxDepth: 80 } };

    // Act
    const result = parseRepositorySubagentConfig(value, "repo/pi-subagent.json");

    // Assert
    expect(result.runtime).toEqual({ maxActiveAgents: 160, maxResidentAgents: 320, maxDepth: 80 });
  });
});

describe("loadRepositorySubagentConfig", () => {
  test("loads trusted config larger than the retired file cap", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-config-"));
    const provider = "p".repeat(1024 * 1024 + 1);
    await writeFile(
      join(root, "pi-subagent.json"),
      JSON.stringify({ agents: { worker: { execution: { provider, model: "model" } } } }),
      "utf8",
    );

    try {
      // Act
      const result = await loadRepositorySubagentConfig(root, true);

      // Assert
      expect(result?.agents.get("worker")?.execution?.provider).toBe(provider);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("never reads repository config when untrusted", async () => {
    // Arrange
    const root = await mkdtemp(join(tmpdir(), "subagent-config-"));
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "pi-subagent.json"), "{ malformed", "utf8");

    try {
      // Act
      const result = await loadRepositorySubagentConfig(root, false);

      // Assert
      expect(result).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENTS } from "./builtins";
import {
  applyAgentOverrideConfig,
  loadAgentOverrideConfig,
  normalizeAgentOverrideConfig,
  SUBAGENT_CONFIG_FILE_NAME,
} from "./config";
import type { AgentDefinition } from "./types";

describe("loadAgentOverrideConfig", () => {
  test("returns undefined when the project has no config", async () => {
    // Arrange
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-subagent-config-"));

    try {
      // Act
      const result = await loadAgentOverrideConfig(projectRoot);

      // Assert
      expect(result).toBeUndefined();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("loads provider, model, and effort overrides", async () => {
    // Arrange
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-subagent-config-"));
    await writeFile(
      join(projectRoot, SUBAGENT_CONFIG_FILE_NAME),
      JSON.stringify({
        agents: {
          reviewer: {
            provider: "anthropic",
            model: "claude-sonnet",
            effort: "high",
            allowEffortOverride: false,
          },
          scout: { effort: "low" },
        },
      }),
      "utf8",
    );

    try {
      // Act
      const result = await loadAgentOverrideConfig(projectRoot);

      // Assert
      expect(result?.agents.get("reviewer")).toEqual({
        model: { provider: "anthropic", id: "claude-sonnet" },
        effort: "high",
        allowEffortOverride: false,
      });
      expect(result?.agents.get("scout")).toEqual({ effort: "low" });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports malformed JSON with the config path", async () => {
    // Arrange
    const projectRoot = await mkdtemp(join(tmpdir(), "pi-subagent-config-"));
    const configPath = join(projectRoot, SUBAGENT_CONFIG_FILE_NAME);
    await writeFile(configPath, "{ broken", "utf8");

    try {
      // Act
      const result = loadAgentOverrideConfig(projectRoot);

      // Assert
      await expect(result).rejects.toThrow(`Could not parse ${configPath}`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe("normalizeAgentOverrideConfig", () => {
  test("requires provider and model together", () => {
    // Arrange
    const value = { agents: { reviewer: { provider: "anthropic" } } };

    // Act
    const parse = () => normalizeAgentOverrideConfig(value, "pi-subagent.json");

    // Assert
    expect(parse).toThrow("provider and pi-subagent.json.agents.reviewer.model must be provided together");
  });

  test("maps legacy max effort to xhigh", () => {
    // Arrange
    const value = { agents: { reviewer: { effort: "max" } } };

    // Act
    const result = normalizeAgentOverrideConfig(value, "pi-subagent.json");

    // Assert
    expect(result.agents.get("reviewer")).toEqual({ effort: "xhigh" });
  });

  test("rejects unsupported effort levels", () => {
    // Arrange
    const value = { agents: { reviewer: { effort: "extreme" } } };

    // Act
    const parse = () => normalizeAgentOverrideConfig(value, "pi-subagent.json");

    // Assert
    expect(parse).toThrow("effort must be one of: off, minimal, low, medium, high, xhigh");
  });

  test("requires a configured effort when effort overrides are disabled", () => {
    // Arrange
    const missingEffort = {
      agents: {
        reviewer: { provider: "anthropic", model: "claude-sonnet", allowEffortOverride: false },
      },
    };
    const invalidFlag = { agents: { reviewer: { effort: "high", allowEffortOverride: "no" } } };

    // Act
    const parseMissingEffort = () => normalizeAgentOverrideConfig(missingEffort, "pi-subagent.json");
    const parseInvalidFlag = () => normalizeAgentOverrideConfig(invalidFlag, "pi-subagent.json");

    // Assert
    expect(parseMissingEffort).toThrow("effort is required when");
    expect(parseInvalidFlag).toThrow("allowEffortOverride must be a boolean");
  });

  test("rejects empty and unknown override fields", () => {
    // Arrange
    const emptyValue = { agents: { reviewer: {} } };
    const unknownValue = { agents: { reviewer: { effort: "high", temperature: 0 } } };

    // Act
    const parseEmpty = () => normalizeAgentOverrideConfig(emptyValue, "pi-subagent.json");
    const parseUnknown = () => normalizeAgentOverrideConfig(unknownValue, "pi-subagent.json");

    // Assert
    expect(parseEmpty).toThrow("must define provider + model, effort, or both");
    expect(parseUnknown).toThrow("contains unknown fields: temperature");
  });
});

describe("applyAgentOverrideConfig", () => {
  test("clones and overrides matching agents without mutating frozen built-ins", () => {
    // Arrange
    const agents = [...BUILTIN_AGENTS];
    const originalScout = agents.find((agent) => agent.name === "scout");
    const config = normalizeAgentOverrideConfig(
      {
        agents: {
          scout: {
            provider: "google",
            model: "gemini-flash",
            effort: "medium",
            allowEffortOverride: false,
          },
        },
      },
      "pi-subagent.json",
    );

    // Act
    const result = applyAgentOverrideConfig(agents, config);

    // Assert
    const scout = result.find((agent) => agent.name === "scout");
    expect(scout).not.toBe(originalScout);
    expect(scout).toMatchObject({
      model: { provider: "google", id: "gemini-flash" },
      effort: "medium",
      allowEffortOverride: false,
    });
    expect(originalScout).toMatchObject({ effort: "low" });
    expect((originalScout as AgentDefinition).model).toBeUndefined();
  });

  test("skips overrides for agents that were not discovered and applies the rest", () => {
    // Arrange
    const config = normalizeAgentOverrideConfig(
      {
        agents: {
          missing: { provider: "google", model: "gemini-flash" },
          scout: { provider: "xai", model: "grok-4.5" },
        },
      },
      "/repo/pi-subagent.json",
    );

    // Act
    const applied = applyAgentOverrideConfig([...BUILTIN_AGENTS], config);

    // Assert
    const scout = applied.find((agent) => agent.name === "scout");
    expect(scout?.model).toEqual({ provider: "xai", id: "grok-4.5" });
    expect(applied.map((agent) => agent.name)).not.toContain("missing");
  });
});

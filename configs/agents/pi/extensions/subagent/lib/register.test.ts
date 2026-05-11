import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { AgentDefinition } from "./agents/types";
import { registerSubagentExtension, registerSubagentTools } from "./register";
import { CHILD_DEPTH_ENV } from "./runner/invocation";
import type { SubagentRuntime } from "./runtime";

describe("registerSubagentExtension", () => {
  test("registers the agent tool in the parent process", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerSubagentExtension(fakePi.pi);

    // Assert
    expect(fakePi.tools.has("agent")).toBe(true);
  });

  test("does not register parent orchestration inside child subagent processes", () => {
    // Arrange
    const fakePi = createFakePi();
    process.env[CHILD_DEPTH_ENV] = "1";

    try {
      // Act
      registerSubagentExtension(fakePi.pi);

      // Assert
      expect(fakePi.tools.has("agent")).toBe(false);
    } finally {
      delete process.env[CHILD_DEPTH_ENV];
    }
  });
});

describe("registerSubagentTools", () => {
  test("injects configured agents into the system prompt before the agent starts", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime: SubagentRuntime = {
      discoverAgents: mock(async () => ({ agentsDir: "/agents", agents: [agent("reviewer")] })),
      runAgent: mock(async () => {
        throw new Error("not used");
      }),
    };
    registerSubagentTools(fakePi.pi, runtime);

    // Act
    const results = await fakePi.emit("before_agent_start", { systemPrompt: "Base prompt" });

    // Assert
    expect(results).toHaveLength(1);
    const result = results[0] as { systemPrompt: string };
    expect(result.systemPrompt).toContain("- reviewer: reviewer description");
    expect(result.systemPrompt).toContain("Base prompt");
  });
});

function agent(name: string): AgentDefinition {
  return {
    name,
    description: `${name} description`,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description: `${name} description` },
  };
}

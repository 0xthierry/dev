import { describe, expect, mock, test } from "bun:test";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import type { AgentDefinition } from "../agents/types";
import type { AgentRunResult } from "../runner/run-result";
import type { SubagentRuntime } from "../runtime";
import { type AgentToolDetails, executeAgentTool, registerAgentTool } from "./agent-tool";

describe("registerAgentTool", () => {
  test("registers the Claude-compatible Agent tool", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime([agent("reviewer")]);

    // Act
    registerAgentTool(fakePi.pi, runtime);

    // Assert
    expect(fakePi.tools.has("Agent")).toBe(true);
    expect(fakePi.tools.get("Agent")?.description).toContain("child Pi sessions");
  });
});

describe("executeAgentTool", () => {
  test("runs a single configured agent", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reviewer = agent("reviewer");
    const runtime = fakeRuntime([reviewer]);
    const ctx = fakePi.createContext({
      cwd: "/repo",
      model: { provider: "test-provider", id: "test-model" },
      sessionManager: { getSessionFile: () => "/sessions/parent.jsonl" },
    }) as unknown as ExtensionContext;

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      { subagent_type: "reviewer", prompt: "Review this diff" },
      undefined,
      undefined,
      ctx,
    );

    // Assert
    expect(result.content[0]).toEqual({ type: "text", text: "reviewer completed: Review this diff" });
    expect(result.details).toMatchObject({ ok: true, mode: "single", agentsDir: "/agents" });
    expect(runtime.runAgent).toHaveBeenCalledTimes(1);
    expect(runtime.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: reviewer,
        task: "Review this diff",
        cwd: "/repo",
        modelRef: "test-provider/test-model",
        thinking: "medium",
      }),
      undefined,
      expect.any(Function),
    );
  });

  test("runs parallel tasks and reports aggregate output", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime([agent("locator"), agent("reviewer")]);
    const updates: Array<AgentToolResult<AgentToolDetails>> = [];

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      {
        tasks: [
          { subagent_type: "locator", prompt: "Find files" },
          { subagent_type: "reviewer", prompt: "Review files" },
        ],
      },
      undefined,
      (partial) => updates.push(partial),
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Parallel agents completed: 2/2 succeeded");
    expect(text).toContain("## locator");
    expect(text).toContain("## reviewer");
    expect(result.details?.results).toHaveLength(2);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[0].details?.results.map((agentResult) => agentResult.status)).toEqual(["queued", "queued"]);
    const hasRunningUpdate = updates.some((update) =>
      update.details?.results.some((agentResult) => agentResult.status === "running"),
    );
    expect(hasRunningUpdate).toBe(true);
  });

  test("keeps parallel agent failures isolated", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime: SubagentRuntime = {
      discoverAgents: mock(async () => ({ agentsDir: "/agents", agents: [agent("locator"), agent("reviewer")] })),
      runAgent: mock(async (request) => {
        if (request.agent.name === "locator") throw new Error("locator crashed");
        return resultFor(request.agent.name, request.task);
      }),
    };

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      {
        tasks: [
          { subagent_type: "locator", prompt: "Find files" },
          { subagent_type: "reviewer", prompt: "Review files" },
        ],
      },
      undefined,
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(result.details?.ok).toBe(false);
    expect(result.details?.results).toHaveLength(2);
    expect(runtime.runAgent).toHaveBeenCalledTimes(2);
    expect(text).toContain("Parallel agents completed: 1/2 succeeded");
    expect(text).toContain("## locator\nAgent locator failed: locator crashed");
    expect(text).toContain("## reviewer\nreviewer completed: Review files");
  });

  test("continues queued parallel tasks after every worker sees a failure", async () => {
    // Arrange
    const fakePi = createFakePi();
    const agents = Array.from({ length: 8 }, (_, index) => agent(`agent-${index}`));
    const runtime: SubagentRuntime = {
      discoverAgents: mock(async () => ({ agentsDir: "/agents", agents })),
      runAgent: mock(async (request) => {
        const index = Number(request.agent.name.replace("agent-", ""));
        if (index < 4) throw new Error(`${request.agent.name} crashed`);
        return resultFor(request.agent.name, request.task);
      }),
    };

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      {
        tasks: agents.map((definition) => ({ subagent_type: definition.name, prompt: `Task for ${definition.name}` })),
      },
      undefined,
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(runtime.runAgent).toHaveBeenCalledTimes(8);
    expect(result.details?.ok).toBe(false);
    expect(result.details?.results.filter((agentResult) => agentResult.ok)).toHaveLength(4);
    expect(text).toContain("Parallel agents completed: 4/8 succeeded");
    expect(text).toContain("## agent-7\nagent-7 completed: Task for agent-7");
  });

  test("returns a helpful error for unknown agents", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime([agent("reviewer")]);

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      { subagent_type: "missing", prompt: "Work" },
      undefined,
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    expect(result.details?.ok).toBe(false);
    expect(result.content[0]).toEqual({ type: "text", text: "Unknown subagent: missing. Available agents: reviewer." });
    expect(runtime.runAgent).not.toHaveBeenCalled();
  });
});

function fakeRuntime(agents: AgentDefinition[]): SubagentRuntime {
  return {
    discoverAgents: mock(async () => ({ agentsDir: "/agents", agents })),
    runAgent: mock(async (request, _signal, onProgress) => {
      const result = resultFor(request.agent.name, request.task);
      onProgress?.(result);
      return result;
    }),
  };
}

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

function resultFor(agentName: string, task: string): AgentRunResult {
  return {
    agent: agentName,
    task,
    context: "fresh",
    status: "succeeded",
    ok: true,
    exitCode: 0,
    finalOutput: `${agentName} completed: ${task}`,
    outputTruncated: false,
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 1 },
    activity: [],
    stopReason: "stop",
  };
}

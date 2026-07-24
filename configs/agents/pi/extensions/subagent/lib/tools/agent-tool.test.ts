import { describe, expect, mock, test } from "bun:test";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import type { AgentDefinition } from "../agents/types";
import type { AgentRunResult } from "../runner/run-result";
import type { SubagentRuntime } from "../runtime";
import { type AgentToolDetails, executeAgentTool, registerAgentTool } from "./agent-tool";

describe("registerAgentTool", () => {
  test("registers the lower-case agent tool", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime([agent("reviewer")]);

    // Act
    registerAgentTool(fakePi.pi, runtime);

    // Assert
    const tool = fakePi.tools.get("agent");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("Spawn or resume a subagent");
    expect(tool?.description).toContain("built-in agents");
    expect(tool?.promptGuidelines).toContain(
      "Before delegating, decide what immediate critical-path work you should do locally; do not hand off urgent blocking work when your next step depends on the result.",
    );
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
      sessionManager: { getSessionFile: () => "/sessions/parent.jsonl", getBranch: () => [] },
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
    expect(runtime.discoverAgents).toHaveBeenCalledWith({ cwd: "/repo", projectTrusted: false });
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

  test("uses an agent model override before the parent model", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reviewer: AgentDefinition = {
      ...agent("reviewer"),
      model: { provider: "override-provider", id: "override-model" },
    };
    const runtime = fakeRuntime([reviewer]);
    const ctx = fakePi.createContext({
      model: { provider: "parent-provider", id: "parent-model" },
    }) as unknown as ExtensionContext;

    // Act
    await executeAgentTool(
      fakePi.pi,
      runtime,
      { subagent_type: "reviewer", prompt: "Review this diff" },
      undefined,
      undefined,
      ctx,
    );

    // Assert
    expect(runtime.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: reviewer, modelRef: "override-provider/override-model" }),
      undefined,
      expect.any(Function),
    );
  });

  test("uses agent frontmatter effort for the child thinking level", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reviewer = agent("reviewer", "high");
    const runtime = fakeRuntime([reviewer]);

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      { subagent_type: "reviewer", prompt: "Review this diff" },
      undefined,
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    expect(runtime.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: reviewer, thinking: "high" }),
      undefined,
      expect.any(Function),
    );
    expect(result.details?.results[0].thinking).toBe("high");
  });

  test("uses tool call effort before agent frontmatter effort", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reviewer = agent("reviewer", "xhigh");
    const runtime = fakeRuntime([reviewer]);

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      { subagent_type: "reviewer", prompt: "Review this diff", effort: "low" },
      undefined,
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    expect(runtime.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: reviewer, thinking: "low" }),
      undefined,
      expect.any(Function),
    );
    expect(result.details?.results[0].thinking).toBe("low");
  });

  test("uses locked agent effort instead of the tool call effort", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reviewer: AgentDefinition = {
      ...agent("reviewer", "medium"),
      allowEffortOverride: false,
    };
    const runtime = fakeRuntime([reviewer]);

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      { subagent_type: "reviewer", prompt: "Review this diff", effort: "max" },
      undefined,
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    );

    // Assert
    expect(runtime.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: reviewer, thinking: "medium" }),
      undefined,
      expect.any(Function),
    );
    expect(result.details?.results[0].thinking).toBe("medium");
  });

  test("resumes a prior child agent session by agent_id", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reviewer = agent("reviewer");
    const runtime = fakeRuntime([reviewer]);
    const ctx = fakePi.createContext({
      sessionManager: {
        getSessionFile: () => "/sessions/parent.jsonl",
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "agent",
              details: {
                results: [
                  {
                    agent: "reviewer",
                    agentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
                    sessionFile: "/agent-sessions/session.jsonl",
                    task: "Review auth",
                  },
                ],
              },
            },
          },
        ],
      },
    }) as unknown as ExtensionContext;

    // Act
    const result = await executeAgentTool(
      fakePi.pi,
      runtime,
      { agent_id: "019e1882", prompt: "Continue the review" },
      undefined,
      undefined,
      ctx,
    );

    // Assert
    expect(runtime.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: reviewer,
        context: "resume",
        task: "Continue the review",
        resumeAgentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
        resumeSessionFile: "/agent-sessions/session.jsonl",
      }),
      undefined,
      expect.any(Function),
    );
    expect(result.content[0]).toEqual({
      type: "text",
      text: "agent_id: 019e1882-8bc8-767c-a1e6-d7c9ebd3a574\nreviewer completed: Continue the review",
    });
    expect(result.details?.results[0]).toMatchObject({
      context: "resume",
      agentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
      sessionFile: "/agent-sessions/session.jsonl",
    });
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
      discoverAgents: mock(async () => ({
        agentsDir: "/agents",
        agentDirs: ["/agents"],
        agents: [agent("locator"), agent("reviewer")],
      })),
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
    expect(text).toContain("## locator\nagent locator failed: locator crashed");
    expect(text).toContain("## reviewer\nreviewer completed: Review files");
  });

  test("runs fifteen parallel tasks concurrently and isolates failures", async () => {
    // Arrange
    const fakePi = createFakePi();
    const agents = Array.from({ length: 15 }, (_, index) => agent(`agent-${index}`));
    let activeRuns = 0;
    let peakActiveRuns = 0;
    const runtime: SubagentRuntime = {
      discoverAgents: mock(async () => ({ agentsDir: "/agents", agentDirs: ["/agents"], agents })),
      runAgent: mock(async (request) => {
        activeRuns += 1;
        peakActiveRuns = Math.max(peakActiveRuns, activeRuns);
        await Promise.resolve();
        activeRuns -= 1;

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
    expect(peakActiveRuns).toBe(15);
    expect(runtime.runAgent).toHaveBeenCalledTimes(15);
    expect(result.details?.ok).toBe(false);
    expect(result.details?.results.filter((agentResult) => agentResult.ok)).toHaveLength(11);
    expect(text).toContain("Parallel agents completed: 11/15 succeeded");
    expect(text).toContain("## agent-14\nagent-14 completed: Task for agent-14");
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
    discoverAgents: mock(async () => ({ agentsDir: "/agents", agentDirs: ["/agents"], agents })),
    runAgent: mock(async (request, _signal, onProgress) => {
      const result = {
        ...resultFor(request.agent.name, request.task, request.thinking),
        context: request.context,
        agentId: request.resumeAgentId,
        sessionFile: request.resumeSessionFile,
      };
      onProgress?.(result);
      return result;
    }),
  };
}

function agent(name: string, effort?: AgentDefinition["effort"]): AgentDefinition {
  return {
    name,
    description: `${name} description`,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description: `${name} description`, ...(effort ? { effort } : {}) },
    ...(effort ? { effort } : {}),
  };
}

function resultFor(agentName: string, task: string, thinking?: AgentRunResult["thinking"]): AgentRunResult {
  return {
    agent: agentName,
    task,
    context: "fresh",
    status: "succeeded",
    ok: true,
    exitCode: 0,
    durationMs: 1_250,
    finalOutput: `${agentName} completed: ${task}`,
    outputTruncated: false,
    stderr: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 1 },
    activity: [],
    stopReason: "stop",
    thinking,
  };
}

import { describe, expect, test } from "bun:test";
import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentRunResult } from "../runner/run-result";
import type { AgentToolDetails } from "./agent-tool";
import { formatAgentToolCall, formatAgentToolResult } from "./render";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("formatAgentToolCall", () => {
  test("shows a resumed subagent id", () => {
    // Arrange
    const params = { agent_id: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574", prompt: "Continue review" };

    // Act
    const text = formatAgentToolCall(params, theme);

    // Assert
    expect(text).toContain("agent resume 019e1882");
    expect(text).toContain("Continue review");
  });

  test("shows parallel subagents", () => {
    // Arrange
    const params = {
      tasks: [
        { subagent_type: "locator", prompt: "Find files related to auth" },
        { subagent_type: "reviewer", prompt: "Review auth behavior" },
      ],
    };

    // Act
    const text = formatAgentToolCall(params, theme);

    // Assert
    expect(text).toContain("agent 2 subagents in parallel");
    expect(text).toContain("locator");
    expect(text).toContain("reviewer");
  });
});

describe("formatAgentToolResult", () => {
  test("shows queued, running, and completed subagents", () => {
    // Arrange
    const result: AgentToolResult<AgentToolDetails> = {
      content: [{ type: "text", text: "running" }],
      details: {
        ok: false,
        mode: "parallel",
        agentsDir: "/agents",
        results: [
          agentResult("locator", "running", [
            {
              kind: "tool",
              toolCallId: "tool-1",
              toolName: "bash",
              status: "running",
              argsPreview: "$ rg auth configs",
            },
          ]),
          agentResult("reviewer", "queued"),
          agentResult("summarizer", "succeeded"),
        ],
      },
    };

    // Act
    const text = formatAgentToolResult(result, { expanded: false, isPartial: true }, theme);

    // Assert
    expect(text).toContain("Subagents");
    expect(text).toContain("1/3 completed");
    expect(text).toContain("1 running");
    expect(text).toContain("1 queued");
    expect(text).toContain("locator");
    expect(text).toContain("$ rg auth configs");
    expect(text).toContain("reviewer");
  });

  test("shows child agent id and session file when expanded", () => {
    // Arrange
    const result: AgentToolResult<AgentToolDetails> = {
      content: [{ type: "text", text: "done" }],
      details: {
        ok: true,
        mode: "single",
        agentsDir: "/agents",
        results: [
          {
            ...agentResult("reviewer", "succeeded"),
            agentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
            sessionFile: "/agent-sessions/session.jsonl",
          },
        ],
      },
    };

    // Act
    const text = formatAgentToolResult(result, { expanded: true }, theme);

    // Assert
    expect(text).toContain("agent_id: 019e1882-8bc8-767c-a1e6-d7c9ebd3a574");
    expect(text).toContain("Session: /agent-sessions/session.jsonl");
  });

  test("shows child model thinking level in usage", () => {
    // Arrange
    const result: AgentToolResult<AgentToolDetails> = {
      content: [{ type: "text", text: "done" }],
      details: {
        ok: true,
        mode: "single",
        agentsDir: "/agents",
        results: [{ ...agentResult("reviewer", "succeeded"), model: "gpt-5.5", thinking: "xhigh" }],
      },
    };

    // Act
    const text = formatAgentToolResult(result, { expanded: false }, theme);

    // Assert
    expect(text).toContain("gpt-5.5 • xhigh");
  });
});

function agentResult(
  agent: string,
  status: AgentRunResult["status"],
  activity: AgentRunResult["activity"] = [],
): AgentRunResult {
  return {
    agent,
    task: `Task for ${agent}`,
    context: "fresh",
    status,
    ok: status === "succeeded",
    exitCode: status === "queued" || status === "running" ? -1 : status === "succeeded" ? 0 : 1,
    finalOutput: status === "succeeded" ? `${agent} output` : status === "queued" ? "(queued)" : "(running...)",
    outputTruncated: false,
    stderr: "",
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 15, turns: 1 },
    activity,
  };
}

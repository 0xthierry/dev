import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentActivity } from "../supervisor/supervisor";
import { formatElapsedTime, hasLiveAgentActivity, renderAgentActivity } from "./activity";

const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

const workingActivity: AgentActivity = {
  state: "working",
  startedAt: 1_000,
  agentType: "codebase-analyzer",
  execution: {
    profile: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "medium" },
    source: { model: "parent", effort: "agent" },
  },
};

describe("renderAgentActivity", () => {
  test("shows active count, elapsed time, agent type, and effective execution", () => {
    // Arrange
    const rows = [{ agentPath: "/root/comparison-race-review", activity: workingActivity }];

    // Act
    const rendered = renderAgentActivity(rows, theme, 160, 126_000);

    // Assert
    expect(rendered).toEqual([
      "Subagents · 1 active",
      "  comparison-race-review — working · 2m 5s",
      "    codebase-analyzer · openai-codex/gpt-5.6-sol · reasoning medium",
    ]);
  });

  test("counts live, queued, and settled agents separately and freezes settled elapsed time", () => {
    // Arrange
    const queuedActivity: AgentActivity = { ...workingActivity, state: "queued" };
    const toolActivity: AgentActivity = { ...workingActivity, state: "tool", toolName: "read" };
    const completedActivity: AgentActivity = { ...workingActivity, state: "completed", finishedAt: 4_000 };
    const failedActivity: AgentActivity = { ...workingActivity, state: "failed", finishedAt: 4_000 };
    const interruptedActivity: AgentActivity = { ...workingActivity, state: "interrupted", finishedAt: 4_000 };
    const rows = [
      { agentPath: "/root/active", activity: workingActivity },
      { agentPath: "/root/tool", activity: toolActivity },
      { agentPath: "/root/waiting", activity: queuedActivity },
      { agentPath: "/root/done", activity: completedActivity },
      { agentPath: "/root/error", activity: failedActivity },
      { agentPath: "/root/stopped", activity: interruptedActivity },
    ];

    // Act
    const firstRender = renderAgentActivity(rows, theme, 200, 6_000);
    const laterRender = renderAgentActivity(rows, theme, 200, 60_000);

    // Assert
    expect(firstRender[0]).toBe("Subagents · 2 active · 1 queued · 1 completed · 1 failed · 1 interrupted");
    expect(firstRender).toContain("  waiting — queued · 5s");
    expect(firstRender).toContain("  done — completed · 3s");
    expect(laterRender).toContain("  done — completed · 3s");
  });

  test("shows the current tool and keeps every line within the available width", () => {
    // Arrange
    const activity: AgentActivity = { ...workingActivity, state: "tool", toolName: "lsp_diagnostics" };

    // Act
    const rendered = renderAgentActivity([{ agentPath: "/root/task", activity }], theme, 32, 6_000);

    // Assert
    expect(rendered.some((line) => line.includes("lsp_diagnostics"))).toBe(true);
    expect(rendered.every((line) => visibleWidth(line) <= 32)).toBe(true);
  });
});

describe("hasLiveAgentActivity", () => {
  test("keeps settled rows visible only while another agent is live", () => {
    // Arrange
    const completed: AgentActivity = { ...workingActivity, state: "completed", finishedAt: 4_000 };
    const settledRows = [{ agentPath: "/root/done", activity: completed }];
    const mixedRows = [...settledRows, { agentPath: "/root/active", activity: workingActivity }];

    // Act
    const settledOnly = hasLiveAgentActivity(settledRows);
    const mixed = hasLiveAgentActivity(mixedRows);

    // Assert
    expect(settledOnly).toBe(false);
    expect(mixed).toBe(true);
  });
});

describe("formatElapsedTime", () => {
  test("formats seconds, minutes, and hours compactly", () => {
    // Arrange
    const elapsed = [9_999, 125_000, 7_500_000];

    // Act
    const formatted = elapsed.map(formatElapsedTime);

    // Assert
    expect(formatted).toEqual(["9s", "2m 5s", "2h 5m"]);
  });
});

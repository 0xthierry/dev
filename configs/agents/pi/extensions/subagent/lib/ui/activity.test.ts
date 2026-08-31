import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentActivity } from "../supervisor/supervisor";
import { formatElapsedTime, renderAgentActivity } from "./activity";

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

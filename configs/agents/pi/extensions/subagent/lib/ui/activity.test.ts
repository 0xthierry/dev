import { describe, expect, jest, mock, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { AgentActivity } from "../supervisor/supervisor";
import { createAgentActivityWidget, formatElapsedTime, hasLiveAgentActivity, renderAgentActivity } from "./activity";

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

describe("createAgentActivityWidget", () => {
  test("invalidates and forces a redraw as active elapsed time advances", () => {
    // Arrange
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2_000));
    const requestRender = mock((_force?: boolean) => {});
    const widget = createAgentActivityWidget(
      [{ agentPath: "/root/active", activity: workingActivity }],
      theme,
      requestRender,
    );

    try {
      const initial = widget.render(160);

      // Act
      jest.advanceTimersByTime(1_000);
      const refreshed = widget.render(160);

      // Assert
      expect(initial).toContain("  active — working · 1s");
      expect(requestRender).toHaveBeenCalledWith(true);
      expect(refreshed).toContain("  active — working · 2s");
    } finally {
      widget.dispose();
      jest.useRealTimers();
    }
  });
});

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

  test("includes follow-ups queued behind a live agent in the summary and row", () => {
    // Arrange
    const activity: AgentActivity = { ...workingActivity, queuedCount: 2 };

    // Act
    const rendered = renderAgentActivity([{ agentPath: "/root/active", activity }], theme, 160, 6_000);

    // Assert
    expect(rendered[0]).toBe("Subagents · 1 active · 2 queued");
    expect(rendered).toContain("  active — working (+2 queued) · 5s");
  });

  test("advances live elapsed time when a working row retains finishedAt", () => {
    // Arrange
    const activity = { ...workingActivity, finishedAt: 4_000 } as AgentActivity;
    const rows = [{ agentPath: "/root/active", activity }];

    // Act
    const firstRender = renderAgentActivity(rows, theme, 160, 6_000);
    const laterRender = renderAgentActivity(rows, theme, 160, 60_000);

    // Assert
    expect(firstRender).toContain("  active — working · 5s");
    expect(laterRender).toContain("  active — working · 59s");
  });

  test("renders transitional live states without requiring an exhaustive state list", () => {
    // Arrange
    const liveStates = ["compacting", "retrying", "finalizing"] as const;
    const rows = liveStates.map((state) => ({
      agentPath: `/root/${state}`,
      activity: { ...workingActivity, state, finishedAt: 2_000 },
    }));

    // Act
    const rendered = renderAgentActivity(rows, theme, 160, 6_000);

    // Assert
    expect(rendered[0]).toBe("Subagents · 3 active");
    expect(rendered).toContain("  compacting — compacting · 5s");
    expect(rendered).toContain("  retrying — retrying · 5s");
    expect(rendered).toContain("  finalizing — finalizing · 5s");
  });

  test("bounds displayed agents and keeps live rows ahead of settled history", () => {
    // Arrange
    const settledRows = Array.from({ length: 8 }, (_, index) => ({
      agentPath: `/root/done-${index}`,
      activity: { ...workingActivity, state: "completed", finishedAt: 4_000 } as AgentActivity,
    }));
    const liveRows = Array.from({ length: 2 }, (_, index) => ({
      agentPath: `/root/active-${index}`,
      activity: workingActivity,
    }));

    // Act
    const rendered = renderAgentActivity([...settledRows, ...liveRows], theme, 160, 6_000);

    // Assert
    expect(rendered[0]).toBe("Subagents · 2 active · 8 completed");
    expect(rendered).toContain("  active-0 — working · 5s");
    expect(rendered).toContain("  active-1 — working · 5s");
    expect(rendered).not.toContain("  done-6 — completed · 3s");
    expect(rendered).toContain("  +2 more");
    expect(rendered).toHaveLength(18);
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
    const futureLive: AgentActivity = { ...workingActivity, state: "compacting" };
    const settledRows = [{ agentPath: "/root/done", activity: completed }];
    const mixedRows = [...settledRows, { agentPath: "/root/active", activity: workingActivity }];
    const futureRows = [{ agentPath: "/root/compacting", activity: futureLive }];

    // Act
    const settledOnly = hasLiveAgentActivity(settledRows);
    const mixed = hasLiveAgentActivity(mixedRows);
    const future = hasLiveAgentActivity(futureRows);

    // Assert
    expect(settledOnly).toBe(false);
    expect(mixed).toBe(true);
    expect(future).toBe(true);
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

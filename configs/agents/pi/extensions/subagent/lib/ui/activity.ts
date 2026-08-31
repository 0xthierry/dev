import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentActivity } from "../supervisor/supervisor";

export interface AgentActivityRow {
  agentPath: string;
  activity: AgentActivity;
}

export function createAgentActivityWidget(
  rows: readonly AgentActivityRow[],
  theme: Theme,
  requestRender: () => void,
): {
  render(width: number): string[];
  invalidate(): void;
  dispose(): void;
} {
  const refresh = setInterval(requestRender, 1_000);
  refresh.unref();

  return {
    render: (width) => renderAgentActivity(rows, theme, width),
    invalidate: () => {},
    dispose: () => clearInterval(refresh),
  };
}

export function hasLiveAgentActivity(rows: readonly AgentActivityRow[]): boolean {
  return rows.some(
    ({ activity }) => activity.state === "queued" || activity.state === "working" || activity.state === "tool",
  );
}

export function renderAgentActivity(
  rows: readonly AgentActivityRow[],
  theme: Theme,
  width: number,
  now = Date.now(),
): string[] {
  const stateCounts = new Map<AgentActivity["state"], number>();
  for (const { activity } of rows) stateCounts.set(activity.state, (stateCounts.get(activity.state) ?? 0) + 1);
  const queuedCount = stateCounts.get("queued") ?? 0;
  const completedCount = stateCounts.get("completed") ?? 0;
  const failedCount = stateCounts.get("failed") ?? 0;
  const interruptedCount = stateCounts.get("interrupted") ?? 0;
  const activeCount = (stateCounts.get("working") ?? 0) + (stateCounts.get("tool") ?? 0);
  const summary = [
    `${activeCount} active`,
    ...(queuedCount > 0 ? [`${queuedCount} queued`] : []),
    ...(completedCount > 0 ? [`${completedCount} completed`] : []),
    ...(failedCount > 0 ? [`${failedCount} failed`] : []),
    ...(interruptedCount > 0 ? [`${interruptedCount} interrupted`] : []),
  ].join(" · ");
  return [
    truncateToWidth(`${theme.fg("muted", "Subagents")} ${theme.fg("dim", `· ${summary}`)}`, width),
    ...rows.flatMap(({ agentPath, activity }) => {
      const name = agentPath.startsWith("/root/") ? agentPath.slice(6) : agentPath;
      const state = activity.state === "tool" ? activity.toolName : activity.state;
      const elapsedUntil = "finishedAt" in activity ? activity.finishedAt : now;
      const elapsed = formatElapsedTime(elapsedUntil - activity.startedAt);
      const profile = activity.execution.profile;
      return [
        truncateToWidth(`  ${theme.fg("accent", name)} ${theme.fg("dim", `— ${state} · ${elapsed}`)}`, width),
        truncateToWidth(
          theme.fg(
            "dim",
            `    ${activity.agentType} · ${profile.provider}/${profile.model} · reasoning ${profile.effort}`,
          ),
          width,
        ),
      ];
    }),
  ];
}

export function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

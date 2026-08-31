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

export function renderAgentActivity(
  rows: readonly AgentActivityRow[],
  theme: Theme,
  width: number,
  now = Date.now(),
): string[] {
  const activeLabel = `${rows.length} active`;
  return [
    truncateToWidth(`${theme.fg("muted", "Subagents")} ${theme.fg("dim", `· ${activeLabel}`)}`, width),
    ...rows.flatMap(({ agentPath, activity }) => {
      const name = agentPath.startsWith("/root/") ? agentPath.slice(6) : agentPath;
      const state = activity.state === "tool" ? activity.toolName : "working";
      const elapsed = formatElapsedTime(now - activity.startedAt);
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

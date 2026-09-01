import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AgentActivity } from "../supervisor/supervisor";

export interface AgentActivityRow {
  agentPath: string;
  activity: AgentActivity;
}

const MAX_VISIBLE_AGENT_ROWS = 8;
const SETTLED_ACTIVITY_STATES: ReadonlySet<string> = new Set(["completed", "failed", "interrupted"]);

export function createAgentActivityWidget(
  rows: readonly AgentActivityRow[],
  theme: Theme,
  requestRender: (force?: boolean) => void,
): {
  render(width: number): string[];
  invalidate(): void;
  dispose(): void;
} {
  let cachedWidth: number | undefined;
  let cachedLines: string[] | undefined;
  const component = {
    render: (width: number) => {
      if (cachedWidth !== width || !cachedLines) {
        cachedWidth = width;
        cachedLines = renderAgentActivity(rows, theme, width);
      }
      return cachedLines;
    },
    invalidate: () => {
      cachedWidth = undefined;
      cachedLines = undefined;
    },
    dispose: () => clearInterval(refresh),
  };
  const refresh = setInterval(() => {
    component.invalidate();
    requestRender(true);
  }, 1_000);
  refresh.unref();
  return component;
}

export function hasLiveAgentActivity(rows: readonly AgentActivityRow[]): boolean {
  return rows.some(({ activity }) => !isSettledActivityState(activity.state));
}

export function renderAgentActivity(
  rows: readonly AgentActivityRow[],
  theme: Theme,
  width: number,
  now = Date.now(),
): string[] {
  const stateCounts = new Map<string, number>();
  for (const { activity } of rows) stateCounts.set(activity.state, (stateCounts.get(activity.state) ?? 0) + 1);
  const queuedCount = rows.reduce(
    (count, { activity }) => count + (activity.state === "queued" ? 1 : 0) + (activity.queuedCount ?? 0),
    0,
  );
  const completedCount = stateCounts.get("completed") ?? 0;
  const failedCount = stateCounts.get("failed") ?? 0;
  const interruptedCount = stateCounts.get("interrupted") ?? 0;
  const activeCount = rows.filter(
    ({ activity }) => activity.state !== "queued" && !isSettledActivityState(activity.state),
  ).length;
  const summary = [
    `${activeCount} active`,
    ...(queuedCount > 0 ? [`${queuedCount} queued`] : []),
    ...(completedCount > 0 ? [`${completedCount} completed`] : []),
    ...(failedCount > 0 ? [`${failedCount} failed`] : []),
    ...(interruptedCount > 0 ? [`${interruptedCount} interrupted`] : []),
  ].join(" · ");
  const visibleRows = [
    ...rows.filter(({ activity }) => !isSettledActivityState(activity.state)),
    ...rows.filter(({ activity }) => isSettledActivityState(activity.state)),
  ].slice(0, MAX_VISIBLE_AGENT_ROWS);
  const hiddenCount = rows.length - visibleRows.length;
  return [
    truncateToWidth(`${theme.fg("muted", "Subagents")} ${theme.fg("dim", `· ${summary}`)}`, width),
    ...visibleRows.flatMap(({ agentPath, activity }) => {
      const name = agentPath.startsWith("/root/") ? agentPath.slice(6) : agentPath;
      const baseState = activity.state === "tool" ? activity.toolName : activity.state;
      const state = activity.queuedCount ? `${baseState} (+${activity.queuedCount} queued)` : baseState;
      const elapsedUntil =
        isSettledActivityState(activity.state) && "finishedAt" in activity ? activity.finishedAt : now;
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
    ...(hiddenCount > 0 ? [truncateToWidth(theme.fg("dim", `  +${hiddenCount} more`), width)] : []),
  ];
}

function isSettledActivityState(state: string): boolean {
  return SETTLED_ACTIVITY_STATES.has(state);
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

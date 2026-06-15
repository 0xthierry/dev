import { normalizeGoalState } from "./goal-state";
import { GOAL_STATE_ENTRY, type GoalState, type GoalStateEntry } from "./types";

export function latestGoalFromEntries(entries: readonly unknown[]): GoalState | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = asRecord(entries[index]);
    if (entry?.type !== "custom" || entry.customType !== GOAL_STATE_ENTRY) continue;
    const data = asRecord(entry.data) as GoalStateEntry | null;
    return normalizeGoalState(data?.goal ?? null);
  }
  return null;
}

export function stateEntry(goal: GoalState | null): GoalStateEntry {
  return { version: 1, goal };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

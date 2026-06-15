export type GoalCommand =
  | { kind: "status" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" }
  | { kind: "auditor" }
  | { kind: "turns"; turns: number }
  | { kind: "create"; objective: string };

export const GOAL_COMMAND_COMPLETIONS = ["status", "pause", "resume", "clear", "turns", "auditor"];

export function parseGoalCommand(args: string): GoalCommand | { kind: "invalid"; message: string } {
  const trimmed = args.trim();
  if (!trimmed || trimmed === "status") return { kind: "status" };
  if (trimmed === "pause") return { kind: "pause" };
  if (trimmed === "resume") return { kind: "resume" };
  if (trimmed === "clear") return { kind: "clear" };
  if (trimmed === "auditor") return { kind: "auditor" };

  const [first, second] = trimmed.split(/\s+/, 2);
  if (first === "turns") {
    const turns = parsePositiveInteger(second ?? "");
    return turns ? { kind: "turns", turns } : { kind: "invalid", message: "Usage: /goal turns <positive turn count>" };
  }

  return { kind: "create", objective: trimmed };
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

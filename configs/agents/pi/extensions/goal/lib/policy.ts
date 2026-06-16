import type { GoalCreationInput, GoalState } from "./types";

export type PolicyResult = { ok: true } | { ok: false; message: string };

const VAGUE_OBJECTIVES = new Set(["help", "do it", "fix it", "make it better", "continue", "work on it"]);
const STOPPING_WORDS =
  /\b(done|complete|until|verified|passes?|success|criteria|finish|delivered|implemented|fixed|working|tests?|build|lint|typecheck|accepted)\b/i;

export const STALL_REFLECT_TURNS = 4;
export const STALL_WARN_TURNS = 8;
export const STALL_PAUSE_TURNS = 16;

export function validateGoalCreation(input: GoalCreationInput, existing: GoalState | null): PolicyResult {
  if (existing && isUnfinished(existing)) {
    return {
      ok: false,
      message:
        "Cannot create a new goal while an unfinished goal exists. Ask the user to /goal clear or complete the current goal first.",
    };
  }

  const contract = validateGoalContract(input);
  if (!contract.ok) return contract;
  if (input.turnBudget != null && (!Number.isFinite(input.turnBudget) || input.turnBudget <= 0)) {
    return { ok: false, message: "Turn budget must be a positive number when provided." };
  }
  return { ok: true };
}

export function validateGoalAmendment(goal: GoalState | null, merged: GoalCreationInput, reason: string): PolicyResult {
  if (!goal) return { ok: false, message: "No goal is set." };
  if (goal.status !== "active" && goal.status !== "paused")
    return { ok: false, message: `Goal is ${goal.status}; amend only applies to active or paused goals.` };
  if (!reason.trim()) return { ok: false, message: "amend requires a summary citing the instruction that changed." };
  return validateGoalContract(merged);
}

function validateGoalContract(input: GoalCreationInput): PolicyResult {
  const objective = input.objective.trim();
  if (!objective) return { ok: false, message: "Goal objective must not be empty." };
  if (objective.length > 4_000) return { ok: false, message: "Goal objective must be at most 4000 characters." };
  if (isVagueObjective(objective)) {
    return {
      ok: false,
      message: "Goal objective is too vague. Include a concrete deliverable and a verifiable stopping condition.",
    };
  }
  if (!hasUsableList(input.successCriteria))
    return { ok: false, message: "Goal requires at least one success criterion." };
  if (!hasUsableList(input.verificationPlan)) return { ok: false, message: "Goal requires a verification plan." };
  if (!hasUsableList(input.evidenceSurface))
    return { ok: false, message: "Goal requires expected evidence references or evidence surface." };
  if (!hasStoppingCondition(objective, input.successCriteria, input.verificationPlan)) {
    return {
      ok: false,
      message: "Goal lacks a verifiable stopping condition. Add explicit success criteria or verification steps.",
    };
  }
  return { ok: true };
}

export function validateUpdateGoalPaused(goal: GoalState | null, summary: string | undefined): PolicyResult {
  if (!goal) return { ok: false, message: "No goal is set." };
  if (goal.status !== "active")
    return { ok: false, message: `Goal is ${goal.status}; pause only applies to active goals.` };
  if (!summary?.trim()) return { ok: false, message: "Pausing requires a summary of what you need from the user." };
  return { ok: true };
}

export function validateUpdateGoalComplete(goal: GoalState | null, summary: string | undefined): PolicyResult {
  if (!goal) return { ok: false, message: "No goal is set." };
  if (!isCompletable(goal))
    return { ok: false, message: `Goal is ${goal.status}; update_goal complete does not apply.` };
  if (!summary?.trim()) return { ok: false, message: "update_goal complete requires a completion summary." };
  return { ok: true };
}

export function validateUpdateGoalBlocked(args: {
  goal: GoalState | null;
  reason?: string;
  evidenceRefs?: string[];
  suggestedUserAction?: string;
}): PolicyResult {
  if (!args.goal) return { ok: false, message: "No goal is set." };
  if (args.goal.status !== "active")
    return { ok: false, message: `Goal is ${args.goal.status}; blocked only applies to active goals.` };
  if (!args.reason?.trim()) return { ok: false, message: "Blocked status requires a structured reason." };
  if (!args.suggestedUserAction?.trim())
    return { ok: false, message: "Blocked status requires a suggested user action." };
  if (!args.evidenceRefs?.some((value) => value.trim()))
    return { ok: false, message: "Blocked status requires evidence references." };
  return { ok: true };
}

export function isUnfinished(goal: GoalState): boolean {
  return goal.status !== "complete" && goal.status !== "budget_limited" && goal.status !== "usage_limited";
}

export function isRunnable(goal: GoalState | null): boolean {
  return goal?.status === "active" && goal.autoContinue;
}

export function isCompletable(goal: GoalState): boolean {
  return (
    goal.status === "active" ||
    goal.status === "paused" ||
    goal.status === "audit_failed" ||
    goal.status === "paused_for_failed_audit"
  );
}

export function applyTurnLimit(goal: GoalState, nowIso: string): GoalState {
  if (goal.status !== "active" || goal.turnsUsed < goal.turnBudget) return goal;
  return {
    ...goal,
    status: "budget_limited",
    autoContinue: false,
    updatedAt: nowIso,
    lastUpdate: "Turn limit reached.",
  };
}

export function applyStallLimit(goal: GoalState, nowIso: string): GoalState {
  if (goal.status !== "active" || goal.stallTurns < STALL_PAUSE_TURNS) return goal;
  return {
    ...goal,
    status: "paused",
    autoContinue: false,
    updatedAt: nowIso,
    lastUpdate: `Auto-paused after ${goal.stallTurns} turns without substantive state change.`,
  };
}

function isVagueObjective(objective: string): boolean {
  const normalized = objective.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized.length < 12 || VAGUE_OBJECTIVES.has(normalized);
}

function hasUsableList(values: string[]): boolean {
  return values.some((value) => value.trim().length >= 4);
}

function hasStoppingCondition(objective: string, successCriteria: string[], verificationPlan: string[]): boolean {
  const joined = [objective, ...successCriteria, ...verificationPlan].join("\n");
  return STOPPING_WORDS.test(joined) && successCriteria.some((criterion) => criterion.trim().length >= 8);
}

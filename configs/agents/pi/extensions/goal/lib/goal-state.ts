import type { GoalAmendmentInput, GoalCreationInput, GoalState } from "./types";

export const DEFAULT_TURN_BUDGET = 512;

export function createGoalState(input: GoalCreationInput, id = newGoalId(new Date())): GoalState {
  const timestamp = new Date().toISOString();
  const objective = input.objective.trim();
  return {
    version: 1,
    id,
    objective,
    canonicalText: buildCanonicalGoalText({ ...input, objective }),
    successCriteria: cleanList(input.successCriteria),
    verificationPlan: cleanList(input.verificationPlan),
    constraints: cleanList(input.constraints),
    evidenceSurface: cleanList(input.evidenceSurface),
    status: "active",
    autoContinue: input.autoContinue,
    createdAt: timestamp,
    updatedAt: timestamp,
    tokensUsed: 0,
    turnsUsed: 0,
    turnBudget: positiveIntegerOrNull(input.turnBudget) ?? DEFAULT_TURN_BUDGET,
    lastContinuationAt: null,
    lastProgressAt: null,
    lastUpdate: null,
    completionClaim: null,
    auditAttempts: 0,
    auditResults: [],
    blockedReason: null,
    suggestedUserAction: null,
    evidenceRefs: [],
    consecutiveBlockedTurns: 0,
    stallTurns: 0,
  };
}

export function mergeAmendment(goal: GoalState, patch: GoalAmendmentInput): GoalCreationInput {
  return {
    objective: (patch.objective ?? goal.objective).trim(),
    successCriteria: patch.successCriteria ? cleanList(patch.successCriteria) : goal.successCriteria,
    verificationPlan: patch.verificationPlan ? cleanList(patch.verificationPlan) : goal.verificationPlan,
    constraints: patch.constraints ? cleanList(patch.constraints) : goal.constraints,
    evidenceSurface: patch.evidenceSurface ? cleanList(patch.evidenceSurface) : goal.evidenceSurface,
    autoContinue: goal.autoContinue,
    turnBudget: goal.turnBudget,
  };
}

export function amendGoalState(goal: GoalState, merged: GoalCreationInput, reason: string): GoalState {
  const now = new Date().toISOString();
  return {
    ...goal,
    objective: merged.objective,
    canonicalText: buildCanonicalGoalText(merged),
    successCriteria: cleanList(merged.successCriteria),
    verificationPlan: cleanList(merged.verificationPlan),
    constraints: cleanList(merged.constraints),
    evidenceSurface: cleanList(merged.evidenceSurface),
    updatedAt: now,
    lastUpdate: `Goal amended: ${reason.trim()}`,
    consecutiveBlockedTurns: 0,
    stallTurns: 0,
  };
}

export function buildCanonicalGoalText(input: GoalCreationInput): string {
  const sections = [
    ["Objective", [input.objective.trim()]],
    ["Success criteria", cleanList(input.successCriteria)],
    ["Verification plan", cleanList(input.verificationPlan)],
    ["Constraints", cleanList(input.constraints)],
    ["Expected evidence", cleanList(input.evidenceSurface)],
  ] as const;

  return sections
    .map(([title, values]) => [`${title}:`, ...values.map((value) => `- ${value}`)].join("\n"))
    .join("\n\n");
}

export function userObjectiveToCreationInput(
  objective: string,
  options: Partial<GoalCreationInput> = {},
): GoalCreationInput {
  return {
    objective: objective.trim(),
    successCriteria: options.successCriteria ?? [
      "The objective is fully satisfied without redefining or narrowing its scope.",
    ],
    verificationPlan: options.verificationPlan ?? [
      "Inspect the current workspace or relevant artifacts before claiming completion.",
      "Run or cite appropriate verification commands when available.",
    ],
    constraints: options.constraints ?? [
      "Respect system, developer, and user instructions.",
      "Do not treat turn limits or stopping as success.",
    ],
    evidenceSurface: options.evidenceSurface ?? [
      "Current files, command output, tests, tool results, or other authoritative artifacts.",
    ],
    autoContinue: options.autoContinue ?? true,
    turnBudget: options.turnBudget,
  };
}

export function normalizeGoalState(value: unknown): GoalState | null {
  const raw = asRecord(value);
  if (!raw || raw.version !== 1) return null;
  const objective = stringValue(raw.objective).trim();
  if (!objective) return null;

  const createdAt = stringValue(raw.createdAt) || new Date().toISOString();
  const updatedAt = stringValue(raw.updatedAt) || createdAt;
  const successCriteria = cleanList(raw.successCriteria);
  const verificationPlan = cleanList(raw.verificationPlan);
  const constraints = cleanList(raw.constraints);
  const evidenceSurface = cleanList(raw.evidenceSurface);
  const fallbackInput: GoalCreationInput = {
    objective,
    successCriteria: successCriteria.length ? successCriteria : ["The objective is complete."],
    verificationPlan: verificationPlan.length ? verificationPlan : ["Inspect current state."],
    constraints,
    evidenceSurface: evidenceSurface.length ? evidenceSurface : ["Concrete current-state evidence."],
    autoContinue: booleanValue(raw.autoContinue, true),
    turnBudget: positiveIntegerOrNull(raw.turnBudget),
  };

  return {
    version: 1,
    id: stringValue(raw.id) || newGoalId(new Date(createdAt)),
    objective,
    canonicalText: stringValue(raw.canonicalText) || buildCanonicalGoalText(fallbackInput),
    successCriteria: fallbackInput.successCriteria,
    verificationPlan: fallbackInput.verificationPlan,
    constraints: fallbackInput.constraints,
    evidenceSurface: fallbackInput.evidenceSurface,
    status: normalizeStatus(raw.status),
    autoContinue: fallbackInput.autoContinue,
    createdAt,
    updatedAt,
    tokensUsed: nonNegativeInteger(raw.tokensUsed),
    turnsUsed: nonNegativeInteger(raw.turnsUsed),
    turnBudget: fallbackInput.turnBudget ?? DEFAULT_TURN_BUDGET,
    lastContinuationAt: nullableString(raw.lastContinuationAt),
    lastProgressAt: nullableString(raw.lastProgressAt),
    lastUpdate: nullableString(raw.lastUpdate),
    completionClaim: normalizeCompletionClaim(raw.completionClaim),
    auditAttempts: nonNegativeInteger(raw.auditAttempts),
    auditResults: Array.isArray(raw.auditResults)
      ? raw.auditResults.map(normalizeAuditResult).filter((result) => result !== null)
      : [],
    blockedReason: nullableString(raw.blockedReason),
    suggestedUserAction: nullableString(raw.suggestedUserAction),
    evidenceRefs: cleanList(raw.evidenceRefs),
    consecutiveBlockedTurns: nonNegativeInteger(raw.consecutiveBlockedTurns),
    stallTurns: nonNegativeInteger(raw.stallTurns),
  };
}

export function goalSummary(goal: GoalState): string {
  return [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Turns: ${goal.turnsUsed}/${goal.turnBudget}`,
    `Tokens used: ${goal.tokensUsed}`,
    goal.completionClaim ? `Completion claim: ${goal.completionClaim.summary}` : undefined,
    latestAuditSummary(goal),
    goal.blockedReason ? `Blocked: ${goal.blockedReason}` : undefined,
    goal.suggestedUserAction ? `Suggested user action: ${goal.suggestedUserAction}` : undefined,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

export function latestAuditSummary(goal: GoalState): string | undefined {
  const latest = goal.auditResults.at(-1);
  if (!latest) return undefined;
  return `Latest audit: ${latest.verdict}${latest.error ? ` (${latest.error})` : ""}`;
}

function normalizeCompletionClaim(value: unknown): GoalState["completionClaim"] {
  const raw = asRecord(value);
  if (!raw) return null;
  const summary = stringValue(raw.summary).trim();
  if (!summary) return null;
  return {
    summary,
    evidenceRefs: cleanList(raw.evidenceRefs),
    claimedAt: stringValue(raw.claimedAt) || new Date().toISOString(),
  };
}

function normalizeAuditResult(value: unknown): GoalState["auditResults"][number] | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const verdict =
    raw.verdict === "approved" || raw.verdict === "disapproved" || raw.verdict === "error" ? raw.verdict : null;
  const report = stringValue(raw.report).trim();
  if (!verdict || !report) return null;
  return {
    verdict,
    report,
    at: stringValue(raw.at) || new Date().toISOString(),
    model: nullableString(raw.model) ?? undefined,
    error: nullableString(raw.error) ?? undefined,
  };
}

function normalizeStatus(value: unknown): GoalState["status"] {
  switch (value) {
    case "active":
    case "paused":
    case "complete":
    case "blocked":
    case "budget_limited":
    case "usage_limited":
    case "audit_failed":
    case "paused_for_failed_audit":
      return value;
    default:
      return "active";
  }
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter((item) => item.length > 0);
}

function positiveIntegerOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.trunc(value);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.trunc(value);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function newGoalId(now: Date): string {
  return `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const GOAL_STATE_ENTRY = "pi-goal-state";
export const GOAL_CONTEXT_MESSAGE = "pi-goal-context";
export const GOAL_STALL_MESSAGE = "pi-goal-stall";
export const GOAL_EVENT_MESSAGE = "pi-goal-event";
export const GOAL_AUDIT_MESSAGE = "pi-goal-audit";

export type GoalStatus =
  | "active"
  | "paused"
  | "complete"
  | "blocked"
  | "budget_limited"
  | "usage_limited"
  | "audit_failed"
  | "paused_for_failed_audit";

export type AuditVerdict = "approved" | "disapproved" | "error";

export type CompletionClaim = {
  summary: string;
  evidenceRefs: string[];
  claimedAt: string;
};

export type AuditResult = {
  verdict: AuditVerdict;
  report: string;
  at: string;
  model?: string;
  error?: string;
};

export type GoalState = {
  version: 1;
  id: string;
  objective: string;
  canonicalText: string;
  successCriteria: string[];
  verificationPlan: string[];
  constraints: string[];
  evidenceSurface: string[];
  status: GoalStatus;
  autoContinue: boolean;
  createdAt: string;
  updatedAt: string;
  tokensUsed: number;
  turnsUsed: number;
  turnBudget: number;
  lastContinuationAt: string | null;
  lastProgressAt: string | null;
  lastUpdate: string | null;
  completionClaim: CompletionClaim | null;
  auditAttempts: number;
  auditResults: AuditResult[];
  blockedReason: string | null;
  suggestedUserAction: string | null;
  evidenceRefs: string[];
  consecutiveBlockedTurns: number;
  stallTurns: number;
};

export type GoalCreationInput = {
  objective: string;
  successCriteria: string[];
  verificationPlan: string[];
  constraints: string[];
  evidenceSurface: string[];
  autoContinue: boolean;
  turnBudget?: number | null;
};

export type GoalAmendmentInput = {
  objective?: string;
  successCriteria?: string[];
  verificationPlan?: string[];
  constraints?: string[];
  evidenceSurface?: string[];
};

export type GoalStateEntry = {
  version: 1;
  goal: GoalState | null;
};

export type GoalAuditorRunInput = {
  goal: GoalState;
  completionClaim: CompletionClaim;
  detailedSummary: string;
  signal?: AbortSignal;
};

export type GoalAuditorRunResult = {
  approved: boolean;
  disapproved: boolean;
  output: string;
  model?: string;
  error?: string;
};

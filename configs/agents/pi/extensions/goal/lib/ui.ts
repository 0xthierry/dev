import { latestAuditSummary } from "./goal-state";
import type { GoalState } from "./types";

export function formatGoalStatus(goal: GoalState | null): string | undefined {
  if (!goal) return undefined;
  const audit = latestAuditSummary(goal);
  const usage = `${goal.turnsUsed}/${goal.turnBudget} turns · ${formatNumber(goal.tokensUsed)} tok`;
  const base = `goal: ${goal.status} · ${truncate(goal.objective, 48)} · ${usage}`;
  return audit ? `${base} · ${audit}` : base;
}

export function formatGoalDetails(goal: GoalState | null): string {
  if (!goal) return "No goal is set. Use /goal <objective> to start one.";
  const lines = [
    `Goal: ${goal.objective}`,
    `Status: ${goal.status}`,
    `Auto-continue: ${goal.autoContinue ? "on" : "off"}`,
    `Turns: ${goal.turnsUsed}/${goal.turnBudget}`,
    `Tokens used: ${goal.tokensUsed}`,
    latestAuditSummary(goal),
    goal.blockedReason ? `Blocked: ${goal.blockedReason}` : undefined,
    goal.suggestedUserAction ? `Suggested action: ${goal.suggestedUserAction}` : undefined,
  ];
  return compactLines(lines);
}

export function formatGoalAuditorStatus(goal: GoalState | null, model: unknown): string {
  const latestAudit = goal?.auditResults.at(-1);
  const claim = goal?.completionClaim;
  const lines = [
    "Goal auditor: mandatory",
    "Runner: isolated in-memory Pi auditor session",
    `Model: ${modelLabel(model)}`,
    "Tools: normal auditor-session tools; prompt instructs no mutation or destructive commands",
    "Approval marker: exact <approved/>",
    "Rejection marker: exact <disapproved/>",
    goal ? `Goal: ${goal.id} (${goal.status})` : "Goal: none",
    goal ? `Audit attempts: ${goal.auditAttempts}` : undefined,
    claim ? `Current completion claim: ${claim.summary}` : "Current completion claim: none",
    claim?.evidenceRefs.length ? `Claim evidence refs: ${claim.evidenceRefs.join(", ")}` : undefined,
    latestAudit ? `Latest audit: ${latestAudit.verdict} at ${latestAudit.at}` : "Latest audit: none",
    latestAudit?.model ? `Latest auditor model: ${latestAudit.model}` : undefined,
    latestAudit?.error ? `Latest audit error: ${latestAudit.error}` : undefined,
    latestAudit?.report ? `Latest audit report: ${truncate(latestAudit.report, 500)}` : undefined,
  ];
  return compactLines(lines);
}

function compactLines(lines: Array<string | undefined>): string {
  return lines.filter((line): line is string => typeof line === "string" && line.length > 0).join("\n");
}

function modelLabel(model: unknown): string {
  if (!model || typeof model !== "object") return "current model unavailable";
  const record = model as Record<string, unknown>;
  const provider = typeof record.provider === "string" ? record.provider : undefined;
  const id = typeof record.id === "string" ? record.id : undefined;
  const name = typeof record.name === "string" ? record.name : undefined;
  if (provider && id) return `${provider}/${id}`;
  return name ?? id ?? provider ?? "current model unavailable";
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
  return String(value);
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

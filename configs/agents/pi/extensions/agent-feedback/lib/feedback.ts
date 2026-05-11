import { FEEDBACK_CATEGORIES, type FeedbackCategory } from "./categories";

export const AGENT_FEEDBACK_HEADING = [
  "# Agent Feedback",
  "",
  "Durable feedback from Pi agents about workflow friction, verification blockers, and project improvements.",
  "",
  "Entries are written by the `agent_feedback` Pi tool. They should describe repeated/systemic issues or concrete validation blockers, not one-off coding mistakes.",
  "",
].join("\n");

export interface NormalizedFeedback {
  category: FeedbackCategory;
  summary: string;
  impact: string;
  attempted?: string;
  blocker?: string;
  suggestedFix?: string;
}

export type FeedbackValidationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CATEGORY"
  | "EMPTY_SUMMARY"
  | "EMPTY_IMPACT"
  | "INVALID_OPTIONAL_FIELD";

export interface FeedbackValidationError {
  code: FeedbackValidationErrorCode;
  message: string;
}

export type NormalizeFeedbackResult =
  | { ok: true; feedback: NormalizedFeedback }
  | { ok: false; error: FeedbackValidationError };

export function normalizeFeedbackInput(input: unknown): NormalizeFeedbackResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return validationError("INVALID_INPUT", "agent_feedback parameters must be an object.");
  }

  const params = input as Record<string, unknown>;
  const category = cleanText(params.category);
  if (!isFeedbackCategory(category)) {
    return validationError(
      "INVALID_CATEGORY",
      `agent_feedback.category must be one of: ${FEEDBACK_CATEGORIES.join(", ")}.`,
    );
  }

  const summary = cleanText(params.summary);
  if (!summary) return validationError("EMPTY_SUMMARY", "agent_feedback.summary must be a non-empty string.");

  const impact = cleanText(params.impact);
  if (!impact) return validationError("EMPTY_IMPACT", "agent_feedback.impact must be a non-empty string.");

  const attempted = cleanOptionalText(params, "attempted");
  if (!attempted.ok) return attempted;

  const blocker = cleanOptionalText(params, "blocker");
  if (!blocker.ok) return blocker;

  const suggestedFix = cleanOptionalText(params, "suggestedFix");
  if (!suggestedFix.ok) return suggestedFix;

  return {
    ok: true,
    feedback: {
      category,
      summary,
      impact,
      ...(attempted.text ? { attempted: attempted.text } : {}),
      ...(blocker.text ? { blocker: blocker.text } : {}),
      ...(suggestedFix.text ? { suggestedFix: suggestedFix.text } : {}),
    },
  };
}

export function formatLocalTimestamp(date: Date): string {
  const day = [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0")].join(":");
  return `${day} ${time}`;
}

export function formatFeedbackEntry(feedback: NormalizedFeedback, timestamp: string): string {
  const lines = [
    `## ${timestamp} — ${feedback.category}`,
    "",
    `Summary: ${feedback.summary}`,
    "",
    `Impact: ${feedback.impact}`,
  ];

  appendOptionalSection(lines, "Attempted", feedback.attempted);
  appendOptionalSection(lines, "Blocker", feedback.blocker);
  appendOptionalSection(lines, "Suggested fix", feedback.suggestedFix);

  return `${lines.join("\n")}\n\n`;
}

function appendOptionalSection(lines: string[], label: string, value: string | undefined): void {
  if (!value) return;
  lines.push("", `${label}:`, value);
}

function cleanOptionalText(
  params: Record<string, unknown>,
  field: "attempted" | "blocker" | "suggestedFix",
): { ok: true; text?: string } | { ok: false; error: FeedbackValidationError } {
  const value = params[field];
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "string") {
    return validationError("INVALID_OPTIONAL_FIELD", `agent_feedback.${field} must be a string when provided.`);
  }
  const text = cleanText(value);
  return text ? { ok: true, text } : { ok: true };
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return redactSecrets(value.trim().replace(/\r\n/g, "\n"));
}

function redactSecrets(value: string): string {
  return value
    .replace(/\b(Authorization\b\s*[:=]\s*)Bearer\s+[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /\b((?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer[_-]?token|token|secret|password|credential|private[_-]?key)\b\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,}|sk-[A-Za-z0-9_-]{20,})\b/g, "[REDACTED]");
}

function isFeedbackCategory(value: string): value is FeedbackCategory {
  return FEEDBACK_CATEGORIES.includes(value as FeedbackCategory);
}

function validationError(
  code: FeedbackValidationErrorCode,
  message: string,
): { ok: false; error: FeedbackValidationError } {
  return { ok: false, error: { code, message } };
}

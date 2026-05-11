export const FEEDBACK_CATEGORIES = [
  "verification_blocker",
  "tooling_friction",
  "instruction_gap",
  "docs_gap",
  "environment_gap",
  "repeated_workaround",
  "other",
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

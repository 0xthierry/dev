#!/usr/bin/env bun
/**
 * Configuration constants for skill matcher hybrid search.
 */

export const CONFIG = {
  // Skills to never suggest (in addition to user-invocable: false)
  excludeSkills: [] as string[],

  // Hard triggers: regex patterns that MUST surface a skill regardless of similarity score
  // These are checked BEFORE hybrid search and guaranteed in top results
  hardTriggers: [
    // Research pipeline
    { pattern: /\bresearch\s+questions?\b/i, skill: 'create-research-questions' },
    { pattern: /\bresearch\s+(?:the\s+)?codebase\b/i, skill: 'create-research' },
    // Design
    { pattern: /\bdesign\s+discussion\b/i, skill: 'create-design-discussion' },
    // Structure outline
    { pattern: /\bstructure\s+outline\b/i, skill: 'create-structure-outline' },
    // Plan
    { pattern: /\b(?:write|create)\s+(?:a\s+)?plan\b/i, skill: 'create-plan' },
    { pattern: /ai_docs\/plans\//i, skill: 'create-plan' },
    // Implementation
    { pattern: /\bimplement\w*\s+(?:the\s+)?plan\b/i, skill: 'implement-plan' },
    { pattern: /ai_docs\/tasks\//i, skill: 'implement-plan' },
    // Worktree
    { pattern: /\bworktree\b/i, skill: 'setup-worktree' },
    // Commits
    { pattern: /\/commit\b/i, skill: 'ci-commit' },
    { pattern: /\bcommit\s+(?:the\s+)?(?:changes|code)\b/i, skill: 'ci-commit' },
    // PR description
    { pattern: /\b(?:describe|generate)\s+(?:the\s+)?(?:pr|pull\s+request)\b/i, skill: 'describe-pr' },
    // Debugging
    { pattern: /\b(?:bug|error|crash(?:ed|ing)?|fail(?:ing|ed|ure)?|broken|not\s+working)\b/i, skill: 'systematic-debugging' },
    // Handoff
    { pattern: /\bhandoff\b/i, skill: 'handoff' },
    { pattern: /\bcontinue\s+later\b/i, skill: 'handoff' },
    // Oracle
    { pattern: /\b(?:ask|get)\s+oracle\b/i, skill: 'asking-oracle' },
    // Adversarial review
    { pattern: /\badversarial\s+review\b/i, skill: 'adversarial-review' },
    // Grill
    { pattern: /\bgrill\s+me\b/i, skill: 'grill-me' },
    // Linear
    { pattern: /\blinear\b/i, skill: 'linear' },
    // Trace analyzer
    { pattern: /\b(?:analyze|review)\s+(?:traces?|sessions?|transcripts?)\b/i, skill: 'trace-analyzer' },
    { pattern: /\bwhat\s+went\s+wrong\b/i, skill: 'trace-analyzer' },
  ] as const,

  // Minimum RRF score to include in results (0.03 = roughly top-15 in both lists)
  minRrfScore: 0.03,

  // Maximum skills to return
  topK: 3,

  // RRF constant (higher = more weight to lower ranks)
  rrfK: 60,

  // Ollama embedding model
  embeddingModel: 'qwen3-embedding:0.6b',

  // Ollama port
  ollamaPort: 11434,

  // Database filename
  dbFilename: 'skills.db',

  // Index state filename
  indexStateFilename: '.index-state.json',
} as const

export type Config = typeof CONFIG

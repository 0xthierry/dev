export type RuleSource = ".pi/rules" | ".agents/rules" | ".claude/rules";

export type RuleActivationMode = "always" | "path" | "agent" | "manual";

export type RuleFrontmatter = {
  alwaysApply?: boolean;
  description?: string;
  paths: string[];
  globs: string[];
  raw: Record<string, string | boolean | string[]>;
  hasFrontmatter: boolean;
};

export type ProjectRule = {
  key: string;
  path: string;
  relativePath: string;
  aliases: string[];
  source: RuleSource;
  name: string;
  content: string;
  frontmatter: RuleFrontmatter;
  mode: RuleActivationMode;
  patterns: string[];
  description?: string;
};

export type RuleActivationReason =
  | { kind: "always" }
  | { kind: "manual"; token: string }
  | { kind: "path"; path: string; pattern: string }
  | { kind: "read"; path: string };

export type RuleActivation = {
  rule: ProjectRule;
  reason: RuleActivationReason;
};

export type RuleDiscoveryResult = {
  rules: ProjectRule[];
  diagnostics: string[];
};

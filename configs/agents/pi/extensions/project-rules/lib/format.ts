import { describeActivationReason } from "./activation";
import type { ProjectRule, RuleActivation } from "./types";

export function formatProjectRulesSystemPrompt(rules: ProjectRule[], activeRuleKeys: Set<string>): string {
  const activeRules = rules.filter((rule) => activeRuleKeys.has(rule.key));
  const inactiveRules = rules.filter((rule) => !activeRuleKeys.has(rule.key) && rule.mode !== "always");
  const sections: string[] = [];

  if (activeRules.length > 0) {
    sections.push(formatActiveRules(activeRules));
  }

  if (inactiveRules.length > 0) {
    sections.push(formatAvailableRules(inactiveRules));
  }

  return sections.join("\n\n");
}

export function formatActivationMessage(activations: RuleActivation[]): string {
  const lines = ["Activated project rule(s):"];
  for (const activation of activations) {
    lines.push(`- ${activation.rule.relativePath} — ${describeActivationReason(activation.reason)}`);
  }
  return lines.join("\n");
}

export function formatRuleActivationContext(activations: RuleActivation[]): string {
  return `${formatActivationMessage(activations)}\n\n${formatActiveRules(activations.map((activation) => activation.rule))}`;
}

export function formatRulesCommand(rules: ProjectRule[], activeRuleKeys: Set<string>): string {
  if (rules.length === 0) return "No project rules discovered.";

  const lines = ["Project rules:"];
  for (const rule of rules) {
    const active = activeRuleKeys.has(rule.key) || rule.mode === "always" ? "active" : "inactive";
    const description = rule.description ? ` — ${rule.description}` : "";
    const patterns = rule.patterns.length > 0 ? ` [${rule.patterns.join(", ")}]` : "";
    lines.push(`- ${rule.relativePath} (${rule.mode}, ${active})${patterns}${description}`);
    if (rule.aliases.length > 1) {
      lines.push(`  aliases: ${rule.aliases.slice(1).join(", ")}`);
    }
  }
  return lines.join("\n");
}

function formatActiveRules(rules: ProjectRule[]): string {
  const lines = [
    "## Active Project Rules",
    "Follow these project rules in addition to AGENTS.md, CLAUDE.md, and other loaded context files.",
  ];

  for (const rule of rules) {
    lines.push("", `### ${rule.relativePath}`, "", rule.content || "[Empty rule file]");
  }

  return lines.join("\n");
}

function formatAvailableRules(rules: ProjectRule[]): string {
  const lines = [
    "## Available Project Rules",
    "These project rules were discovered but are not active yet. If one is relevant, read the rule file; Pi will mark it as activated when it is read or when a matching path is accessed.",
  ];

  for (const rule of rules) {
    const hint = formatRuleHint(rule);
    lines.push(`- @${rule.name} — ${rule.relativePath} (${rule.mode}${hint})`);
  }

  return lines.join("\n");
}

function formatRuleHint(rule: ProjectRule): string {
  if (rule.patterns.length > 0) return `; patterns: ${rule.patterns.join(", ")}`;
  if (rule.description) return `; ${rule.description}`;
  return "";
}

import { describeActivationReason } from "./activation";
import type { ProjectRule, RuleActivation } from "./types";

export function formatProjectRulesSystemPrompt(rules: ProjectRule[]): string {
  if (rules.length === 0) return "";

  const sections = [formatRuleCatalog(rules)];
  const alwaysRules = rules.filter((rule) => rule.mode === "always");
  if (alwaysRules.length > 0) {
    sections.push(formatAlwaysRules(alwaysRules));
  }

  return sections.join("\n\n");
}

function formatRuleCatalog(rules: ProjectRule[]): string {
  const lines = [
    "## Available Project Rules",
    "These project-root-relative rule files were discovered for this project. Always rule bodies are included below; other rule bodies are added to context only when activated by a matching path, a manual @rule mention, or reading the rule file.",
  ];

  for (const rule of rules) {
    const metadata = formatCatalogMetadata(rule);
    lines.push(`- @${rule.name} — ${rule.relativePath}${metadata}`);
  }

  return lines.join("\n");
}

function formatAlwaysRules(rules: ProjectRule[]): string {
  const lines = [
    "## Always Project Rules",
    "Follow these project rule bodies on every turn in addition to AGENTS.md, CLAUDE.md, and other loaded context files.",
  ];

  for (const rule of rules) {
    lines.push("", `### ${rule.relativePath}`, "", rule.content || "[Empty rule file]");
  }

  return lines.join("\n");
}

export function formatActivationMessage(activations: RuleActivation[]): string {
  const lines = ["Activated project rule(s):"];
  for (const activation of activations) {
    lines.push(`- ${activation.rule.relativePath} — ${describeActivationReason(activation.reason)}`);
  }
  return lines.join("\n");
}

export function formatRuleActivationContext(activations: RuleActivation[]): string {
  const lines = [
    "## Active Project Rules",
    "Follow these activated project rule bodies in addition to AGENTS.md, CLAUDE.md, and other loaded context files.",
  ];

  for (const activation of activations) {
    lines.push(
      "",
      `### ${activation.rule.relativePath}`,
      "",
      activation.rule.content || "[Empty rule file]",
      "",
      `Activation reason: ${describeActivationReason(activation.reason)}`,
    );
  }

  return lines.join("\n");
}

export function formatRulesCommand(rules: ProjectRule[], activeRuleKeys: Set<string>): string {
  if (rules.length === 0) return "No project rules discovered.";

  const lines = ["Project rules:"];
  for (const rule of rules) {
    const active = activeRuleKeys.has(rule.key) ? "active" : "inactive";
    const description = rule.description ? ` — ${rule.description}` : "";
    const patterns = rule.patterns.length > 0 ? ` [${rule.patterns.join(", ")}]` : "";
    lines.push(`- ${rule.relativePath} (${rule.mode}, ${active})${patterns}${description}`);
    if (rule.aliases.length > 1) {
      lines.push(`  aliases: ${rule.aliases.slice(1).join(", ")}`);
    }
  }
  return lines.join("\n");
}

function formatCatalogMetadata(rule: ProjectRule): string {
  const metadata: string[] = [];
  if (rule.patterns.length > 0) metadata.push(`patterns: ${rule.patterns.join(", ")}`);
  if (rule.description) metadata.push(`description: ${rule.description}`);
  return metadata.length > 0 ? `; ${metadata.join("; ")}` : "";
}

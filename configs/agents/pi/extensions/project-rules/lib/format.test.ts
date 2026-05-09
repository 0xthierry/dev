import { describe, expect, test } from "bun:test";
import { formatActivationMessage, formatProjectRulesSystemPrompt, formatRulesCommand } from "./format";
import type { ProjectRule, RuleActivation } from "./types";

function rule(overrides: Partial<ProjectRule>): ProjectRule {
  return {
    key: overrides.key ?? "rule",
    path: overrides.path ?? "/repo/.pi/rules/rule.md",
    relativePath: overrides.relativePath ?? ".pi/rules/rule.md",
    aliases: overrides.aliases ?? [overrides.relativePath ?? ".pi/rules/rule.md"],
    source: ".pi/rules",
    name: overrides.name ?? "rule",
    content: overrides.content ?? "Rule body",
    frontmatter: overrides.frontmatter ?? { paths: [], globs: [], raw: {}, hasFrontmatter: false },
    mode: overrides.mode ?? "always",
    patterns: overrides.patterns ?? [],
    description: overrides.description,
  };
}

describe("formatProjectRulesSystemPrompt", () => {
  test("includes active rule bodies and inactive rule metadata", () => {
    // Arrange
    const active = rule({ key: "active", relativePath: ".pi/rules/testing.md", content: "Run tests." });
    const inactive = rule({
      key: "inactive",
      relativePath: ".pi/rules/api.md",
      name: "api",
      mode: "agent",
      description: "API conventions",
    });

    // Act
    const prompt = formatProjectRulesSystemPrompt([active, inactive], new Set(["active"]));

    // Assert
    expect(prompt).toContain("## Active Project Rules");
    expect(prompt).toContain("Run tests.");
    expect(prompt).toContain("## Available Project Rules");
    expect(prompt).toContain("@api");
  });
});

describe("formatActivationMessage", () => {
  test("shows paths and activation reasons", () => {
    // Arrange
    const activation: RuleActivation = {
      rule: rule({ relativePath: ".pi/rules/testing.md" }),
      reason: { kind: "always" },
    };

    // Act
    const message = formatActivationMessage([activation]);

    // Assert
    expect(message).toBe("Activated project rule(s):\n- .pi/rules/testing.md — always");
  });
});

describe("formatRulesCommand", () => {
  test("lists active status, patterns, descriptions, and aliases", () => {
    // Arrange
    const rules = [
      rule({
        key: "api",
        relativePath: ".pi/rules/api.md",
        aliases: [".pi/rules/api.md", ".claude/rules/api.md"],
        mode: "path",
        patterns: ["src/api/**/*.ts"],
        description: "API conventions",
      }),
    ];

    // Act
    const message = formatRulesCommand(rules, new Set(["api"]));

    // Assert
    expect(message).toContain(".pi/rules/api.md (path, active) [src/api/**/*.ts] — API conventions");
    expect(message).toContain("aliases: .claude/rules/api.md");
  });
});

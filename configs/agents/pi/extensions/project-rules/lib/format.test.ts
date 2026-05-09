import { describe, expect, test } from "bun:test";
import {
  formatActivationMessage,
  formatProjectRulesSystemPrompt,
  formatRuleActivationContext,
  formatRulesCommand,
} from "./format";
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
  test("includes a stable catalog without activation status or rule bodies", () => {
    // Arrange
    const always = rule({ key: "testing", relativePath: ".pi/rules/testing.md", content: "Run tests." });
    const pathRule = rule({
      key: "api",
      relativePath: ".pi/rules/api.md",
      name: "api",
      mode: "path",
      patterns: ["src/api/**/*.ts"],
      description: "API conventions",
    });

    // Act
    const prompt = formatProjectRulesSystemPrompt([always, pathRule]);

    // Assert
    expect(prompt).toContain("## Available Project Rules");
    expect(prompt).toContain("@api — .pi/rules/api.md; patterns: src/api/**/*.ts; description: API conventions");
    expect(prompt).not.toContain("active");
    expect(prompt).not.toContain("inactive");
    expect(prompt).not.toContain("Run tests.");
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

describe("formatRuleActivationContext", () => {
  test("puts stable rule content before dynamic activation reasons", () => {
    // Arrange
    const activation: RuleActivation = {
      rule: rule({ relativePath: ".pi/rules/testing.md", content: "Run tests." }),
      reason: { kind: "path", path: "src/foo.test.ts", pattern: "src/**/*.ts" },
    };

    // Act
    const message = formatRuleActivationContext([activation]);

    // Assert
    expect(message).toContain("## Active Project Rules");
    expect(message.indexOf("Run tests.")).toBeLessThan(message.indexOf("Activation reason:"));
    expect(message).toContain("Activation reason: matched src/foo.test.ts via src/**/*.ts");
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

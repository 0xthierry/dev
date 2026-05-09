import { describe, expect, test } from "bun:test";
import {
  extractManualRuleTokens,
  extractPromptPaths,
  findRuleReadActivation,
  markActivations,
  planPathActivations,
  planPromptActivations,
} from "./activation";
import type { ProjectRule } from "./types";

function rule(overrides: Partial<ProjectRule>): ProjectRule {
  return {
    key: overrides.key ?? overrides.relativePath ?? "rule",
    path: overrides.path ?? `/repo/${overrides.relativePath ?? "rule.md"}`,
    relativePath: overrides.relativePath ?? "rule.md",
    aliases: overrides.aliases ?? [overrides.relativePath ?? "rule.md"],
    source: overrides.source ?? ".pi/rules",
    name: overrides.name ?? "rule",
    content: overrides.content ?? "Rule body",
    frontmatter: overrides.frontmatter ?? {
      paths: [],
      globs: [],
      raw: {},
      hasFrontmatter: false,
    },
    mode: overrides.mode ?? "always",
    patterns: overrides.patterns ?? [],
    description: overrides.description,
  };
}

describe("planPromptActivations", () => {
  test("activates always rules and prompt-matched path rules", () => {
    // Arrange
    const rules = [
      rule({ key: "always", relativePath: ".pi/rules/testing.md", name: "testing" }),
      rule({
        key: "api",
        relativePath: ".pi/rules/api.md",
        name: "api",
        mode: "path",
        patterns: ["src/api/**/*.ts"],
      }),
    ];

    // Act
    const plan = planPromptActivations(rules, "Update @src/api/users.ts", [], new Set());

    // Assert
    expect(plan.newActivations.map((activation) => activation.rule.key)).toEqual(["always", "api"]);
  });

  test("activates manual rules by @rule-name", () => {
    // Arrange
    const rules = [
      rule({ key: "migration", relativePath: ".agents/rules/migration.md", name: "migration", mode: "manual" }),
    ];

    // Act
    const plan = planPromptActivations(rules, "Use @migration for this change", [], new Set());

    // Assert
    expect(plan.newActivations).toHaveLength(1);
    expect(plan.newActivations[0]?.reason).toEqual({ kind: "manual", token: "migration" });
  });

  test("does not report already active rules as new", () => {
    // Arrange
    const rules = [rule({ key: "testing", relativePath: ".pi/rules/testing.md" })];
    const active = new Set<string>();
    markActivations(active, planPromptActivations(rules, "hello", [], active).newActivations);

    // Act
    const plan = planPromptActivations(rules, "hello again", [], active);

    // Assert
    expect(plan.active.map((activation) => activation.rule.key)).toEqual(["testing"]);
    expect(plan.newActivations).toEqual([]);
  });
});

describe("planPathActivations", () => {
  test("activates path rules after a matching tool path", () => {
    // Arrange
    const rules = [rule({ key: "tsx", mode: "path", patterns: ["src/**/*.tsx"] })];

    // Act
    const plan = planPathActivations(rules, "src/components/App.tsx", new Set());

    // Assert
    expect(plan.newActivations[0]?.reason).toEqual({
      kind: "path",
      path: "src/components/App.tsx",
      pattern: "src/**/*.tsx",
    });
  });
});

describe("findRuleReadActivation", () => {
  test("activates a rule when the read tool opens the rule file", () => {
    // Arrange
    const rules = [rule({ key: "testing", path: "/repo/.pi/rules/testing.md", relativePath: ".pi/rules/testing.md" })];

    // Act
    const activation = findRuleReadActivation(rules, "/repo", ".pi/rules/testing.md", new Set());

    // Assert
    expect(activation?.reason).toEqual({ kind: "read", path: ".pi/rules/testing.md" });
  });
});

describe("prompt extraction", () => {
  test("extracts paths and manual tokens", () => {
    // Arrange
    const prompt = "Review @src/index.ts and use @testing.";

    // Act
    const paths = extractPromptPaths(prompt);
    const tokens = [...extractManualRuleTokens(prompt)];

    // Assert
    expect(paths).toContain("src/index.ts");
    expect(tokens).toContain("testing");
  });
});

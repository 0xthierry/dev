import { describe, expect, test } from "bun:test";
import { classifyRule, parseRuleFile } from "./frontmatter";

describe("parseRuleFile", () => {
  test("parses Claude-style path frontmatter", () => {
    // Arrange
    const content = `---
paths:
  - "src/api/**/*.ts"
  - tests/**/*.test.ts
---
# API rules

Validate inputs.
`;

    // Act
    const result = parseRuleFile(content);

    // Assert
    expect(result.frontmatter.paths).toEqual(["src/api/**/*.ts", "tests/**/*.test.ts"]);
    expect(result.body).toBe("# API rules\n\nValidate inputs.");
    expect(classifyRule(result.frontmatter)).toBe("path");
  });

  test("parses Cursor-style mdc metadata", () => {
    // Arrange
    const content = `---
description: RPC service conventions
globs: "src/**/*.ts, tests/**/*.ts"
alwaysApply: false
---
Use structured errors.
`;

    // Act
    const result = parseRuleFile(content);

    // Assert
    expect(result.frontmatter.description).toBe("RPC service conventions");
    expect(result.frontmatter.globs).toEqual(["src/**/*.ts", "tests/**/*.ts"]);
    expect(result.frontmatter.alwaysApply).toBe(false);
    expect(classifyRule(result.frontmatter)).toBe("path");
  });

  test("classifies plain markdown as always active", () => {
    // Arrange
    const content = "# Testing\n\nRun focused tests.";

    // Act
    const result = parseRuleFile(content);

    // Assert
    expect(result.frontmatter.hasFrontmatter).toBe(false);
    expect(classifyRule(result.frontmatter)).toBe("always");
  });

  test("classifies explicit false without selectors as manual", () => {
    // Arrange
    const content = `---
alwaysApply: false
---
Optional migration checklist.
`;

    // Act
    const result = parseRuleFile(content);

    // Assert
    expect(classifyRule(result.frontmatter)).toBe("manual");
  });
});

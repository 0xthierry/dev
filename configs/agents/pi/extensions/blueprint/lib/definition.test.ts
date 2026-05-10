import { describe, expect, test } from "bun:test";
import { normalizeBlueprintDefinition } from "./definition";

describe("normalizeBlueprintDefinition", () => {
  test("normalizes a valid graph with pi and command nodes", () => {
    // Arrange
    const input = {
      name: "implement",
      description: "Implement with checks",
      start: "implement",
      nodes: {
        implement: {
          type: "pi",
          prompt: "Implement {{input.task}}",
          tools: ["read", "edit"],
          skills: ["./skills/research/SKILL.md"],
          thinking: "HIGH",
          next: "lint",
        },
        lint: {
          type: "command",
          run: "bun run lint",
          on: { success: "done", failure: "fix" },
        },
        fix: {
          type: "pi",
          promptFile: "fix.md",
          maxAttempts: 2,
          next: "lint",
        },
        done: { type: "stop", message: "Done" },
      },
    };

    // Act
    const result = normalizeBlueprintDefinition(input);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.name).toBe("implement");
    expect(result.definition.nodes.implement).toMatchObject({
      type: "pi",
      thinking: "high",
      tools: ["read", "edit"],
      skills: ["./skills/research/SKILL.md"],
    });
    expect(result.definition.nodes.lint).toMatchObject({ type: "command", run: "bun run lint" });
  });

  test("defaults start to the first node", () => {
    // Arrange
    const input = {
      name: "simple",
      nodes: {
        first: { type: "stop" },
      },
    };

    // Act
    const result = normalizeBlueprintDefinition(input);

    // Assert
    expect(result).toMatchObject({ ok: true, definition: { start: "first" } });
  });

  test("reports missing required fields and bad edges", () => {
    // Arrange
    const input = {
      name: "broken",
      start: "missing",
      nodes: {
        step: { type: "command", run: "echo ok", next: "missing" },
        bad: { type: "pi", thinking: "maximum" },
      },
    };

    // Act
    const result = normalizeBlueprintDefinition(input);

    // Assert
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain("Start node 'missing' does not exist.");
    expect(result.errors).toContain("Node 'step' references missing node 'missing'.");
    expect(result.errors).toContain("Node 'bad' must define prompt or promptFile.");
    expect(result.errors).toContain("Node 'bad' has unsupported thinking level.");
  });
});

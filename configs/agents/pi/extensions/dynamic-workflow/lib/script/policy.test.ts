import { describe, expect, test } from "bun:test";
import { parseWorkflowScript } from "./parse";
import { assertWorkflowSourcePolicy } from "./policy";

describe("workflow script policy", () => {
  test("rejects oversized scripts", () => {
    // Arrange
    const script = "x".repeat(11);

    // Act / Assert
    expect(() => assertWorkflowSourcePolicy(script, { maxScriptBytes: 10 })).toThrow(/too large/);
  });

  test("rejects nondeterministic and ambient APIs", () => {
    // Arrange
    const scripts = [
      "return Date.now()",
      "return Math.random()",
      "return new Date()",
      "return require('fs')",
      "return process.env.HOME",
      "return globalThis.process",
      "return eval('1 + 1')",
      "return Function('return 1')()",
      "return fetch('https://example.com')",
    ].map((body) => `export const meta = { name: 'demo', description: 'desc' }\n${body}`);

    // Act
    const results = scripts.map((script) => () => parseWorkflowScript(script));

    // Assert
    for (const parse of results) expect(parse).toThrow(/Workflow scripts cannot|unavailable/);
  });

  test("allows process.cwd and ordinary deterministic expressions", () => {
    // Arrange
    const script =
      "export const meta = { name: 'demo', description: 'desc' }\nreturn process.cwd() + JSON.stringify(args)";

    // Act
    const parsed = parseWorkflowScript(script);

    // Assert
    expect(parsed.body).toContain("process.cwd");
  });
});

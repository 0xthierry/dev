import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatAgentCall, formatAgentResult } from "./render";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

describe("formatAgentCall", () => {
  test("renders the bounded normalized message below its target", () => {
    // Arrange
    const message = `Inspect\n  the race ${"x".repeat(200)}`;

    // Act
    const rendered = formatAgentCall("agent_send", "/root/task", theme, message);

    // Assert
    expect(rendered).toStartWith("agent_send /root/task\n  Inspect the race ");
    expect(rendered).toEndWith("…");
    expect(rendered.length).toBeLessThan(message.length);
  });

  test("keeps calls without a message on one line", () => {
    // Arrange
    const target = "/root/task";

    // Act
    const rendered = formatAgentCall("agent_interrupt", target, theme);

    // Assert
    expect(rendered).toBe("agent_interrupt /root/task");
  });
});

describe("formatAgentResult", () => {
  test("renders effective execution in assignment admission results", () => {
    // Arrange
    const result = successfulResult("agent_followup", {
      status: "running",
      execution: {
        profile: { provider: "openai-codex", model: "gpt-5.4", effort: "high" },
        source: { model: "parent", effort: "agent" },
      },
    });

    // Act
    const rendered = formatAgentResult(result, false, theme);

    // Assert
    expect(rendered).toBe("✓ agent_followup running · openai-codex/gpt-5.4 · reasoning high");
  });

  test("renders delivery, wait, list, and artifact outcomes instead of generic completion", () => {
    // Arrange
    const results = [
      successfulResult("agent_send", { delivery: "steered" }),
      successfulResult("agent_wait", { timedOut: false, completed: [{}], pending: [{}, {}] }),
      successfulResult("agent_list", [{}, {}]),
      successfulResult("agent_wait.read_artifact", { lines: 12, bytes: 640, eof: false }),
    ];

    // Act
    const rendered = results.map((result) => formatAgentResult(result, false, theme));

    // Assert
    expect(rendered).toEqual([
      "✓ agent_send steered",
      "✓ agent_wait 1 completed · 2 pending",
      "✓ agent_list 2 agents",
      "✓ agent_wait.read_artifact 12 lines · 640 bytes · more",
    ]);
  });

  test("renders typed failures compactly", () => {
    // Arrange
    const result = {
      content: [{ type: "text" as const, text: "Target was not found" }],
      details: { ok: false, operation: "agent_send", error: { kind: "invalid_path", message: "not found" } },
    };

    // Act
    const rendered = formatAgentResult(result, false, theme);

    // Assert
    expect(rendered).toBe("✗ agent_send invalid_path");
  });

  test("renders model-visible details only when expanded", () => {
    // Arrange
    const result = successfulResult("agent_list", [{ status: "idle" }]);

    // Act
    const compact = formatAgentResult(result, false, theme);
    const expanded = formatAgentResult(result, true, theme);

    // Assert
    expect(compact).not.toContain("full details");
    expect(expanded).toContain("full details");
  });
});

function successfulResult(operation: string, result: unknown) {
  return {
    content: [{ type: "text" as const, text: "full details" }],
    details: { ok: true, operation, result },
  };
}

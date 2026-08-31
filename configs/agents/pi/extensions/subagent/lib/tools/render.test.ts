import { expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatAgentCall, formatAgentResult } from "./render";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("renders compact calls without exposing details", () => {
  // Arrange
  const target = "/root/task";

  // Act
  const rendered = formatAgentCall("agent_send", target, theme);

  // Assert
  expect(rendered).toContain("agent_send /root/task");
});

test("renders model-visible details only when expanded", () => {
  // Arrange
  const result = {
    content: [{ type: "text" as const, text: "safe details" }],
    details: { ok: true, operation: "agent_list" },
  };

  // Act
  const compact = formatAgentResult(result, false, theme);
  const expanded = formatAgentResult(result, true, theme);

  // Assert
  expect(compact).not.toContain("safe details");
  expect(expanded).toContain("safe details");
});

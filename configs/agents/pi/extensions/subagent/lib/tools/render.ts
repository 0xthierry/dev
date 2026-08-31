import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { AgentToolDetails } from "./shared";

export function formatAgentCall(name: string, target: unknown, theme: Theme): string {
  const suffix = typeof target === "string" && target ? ` ${target}` : "";
  return `${theme.fg("toolTitle", theme.bold(name))}${theme.fg("muted", suffix)}`;
}

export function renderAgentCall(name: string, target: unknown, theme: Theme): Text {
  return new Text(formatAgentCall(name, target, theme), 0, 0);
}

export function formatAgentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): string {
  const details = result.details as AgentToolDetails<unknown> | undefined;
  const ok = details?.ok === true;
  const marker = ok ? theme.fg("success", "✓") : theme.fg("error", "✗");
  const summary = `${marker} ${details?.operation ?? "agent operation"} ${ok ? "completed" : "failed"}`;
  if (!expanded) return summary;
  const text = result.content.find((part) => part.type === "text")?.text;
  return text ? `${summary}\n\n${text}` : summary;
}

export function renderAgentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): Text {
  return new Text(formatAgentResult(result, expanded, theme), 0, 0);
}

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
  const outcome = ok ? compactResultSummary(details?.result) : undefined;
  const summary = `${marker} ${details?.operation ?? "agent operation"} ${outcome ?? (ok ? "completed" : "failed")}`;
  if (!expanded) return summary;
  const text = result.content.find((part) => part.type === "text")?.text;
  return text ? `${summary}\n\n${text}` : summary;
}

export function renderAgentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): Text {
  return new Text(formatAgentResult(result, expanded, theme), 0, 0);
}

function compactResultSummary(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  const status = typeof record.status === "string" ? record.status : undefined;
  const execution = record.execution;
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) return status;
  const profile = (execution as Record<string, unknown>).profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return status;
  const values = profile as Record<string, unknown>;
  const provider = typeof values.provider === "string" ? values.provider : undefined;
  const model = typeof values.model === "string" ? values.model : undefined;
  const effort = typeof values.effort === "string" ? values.effort : undefined;
  if (!provider || !model || !effort) return status;
  return `${status ? `${status} · ` : ""}provider ${provider} · model ${model} · reasoning ${effort}`;
}

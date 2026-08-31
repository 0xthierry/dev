import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { AgentToolDetails } from "./shared";

const MESSAGE_PREVIEW_CHARACTERS = 160;

export function formatAgentCall(name: string, target: unknown, theme: Theme, message?: unknown): string {
  const suffix = typeof target === "string" && target ? ` ${target}` : "";
  const preview = formatMessagePreview(message);
  const header = `${theme.fg("toolTitle", theme.bold(name))}${theme.fg("muted", suffix)}`;
  return preview ? `${header}\n${theme.fg("dim", `  ${preview}`)}` : header;
}

export function renderAgentCall(name: string, target: unknown, theme: Theme, message?: unknown): Text {
  return new Text(formatAgentCall(name, target, theme, message), 0, 0);
}

export function formatAgentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): string {
  const details = result.details as AgentToolDetails<unknown> | undefined;
  const ok = details?.ok === true;
  const marker = ok ? theme.fg("success", "✓") : theme.fg("error", "✗");
  const outcome = ok ? compactResultSummary(details?.result) : details?.error?.kind;
  const summary = `${marker} ${details?.operation ?? "agent operation"} ${outcome ?? (ok ? "completed" : "failed")}`;
  if (!expanded) return summary;
  const text = result.content.find((part) => part.type === "text")?.text;
  return text ? `${summary}\n\n${text}` : summary;
}

export function renderAgentResult(result: AgentToolResult<unknown>, expanded: boolean, theme: Theme): Text {
  return new Text(formatAgentResult(result, expanded, theme), 0, 0);
}

function formatMessagePreview(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const characters = Array.from(normalized);
  if (characters.length <= MESSAGE_PREVIEW_CHARACTERS) return normalized;
  return `${characters.slice(0, MESSAGE_PREVIEW_CHARACTERS).join("")}…`;
}

function compactResultSummary(result: unknown): string | undefined {
  if (Array.isArray(result)) return `${result.length} agent${result.length === 1 ? "" : "s"}`;
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;

  const delivery = stringValue(record.delivery);
  if (delivery) return delivery;

  if (typeof record.timedOut === "boolean") {
    const completed = Array.isArray(record.completed) ? record.completed.length : 0;
    const pending = Array.isArray(record.pending) ? record.pending.length : 0;
    const counts = `${completed} completed · ${pending} pending`;
    return record.timedOut ? `timed out · ${counts}` : counts;
  }

  if (typeof record.lines === "number" && typeof record.bytes === "number" && typeof record.eof === "boolean") {
    return `${record.lines} line${record.lines === 1 ? "" : "s"} · ${record.bytes} bytes · ${record.eof ? "complete" : "more"}`;
  }

  const status = stringValue(record.status);
  const execution = executionSummary(record.execution);
  if (status && execution) return `${status} · ${execution}`;
  return status;
}

function executionSummary(execution: unknown): string | undefined {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) return undefined;
  const profile = (execution as Record<string, unknown>).profile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return undefined;
  const values = profile as Record<string, unknown>;
  const provider = stringValue(values.provider);
  const model = stringValue(values.model);
  const effort = stringValue(values.effort);
  if (!provider || !model || !effort) return undefined;
  return `${provider}/${model} · reasoning ${effort}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

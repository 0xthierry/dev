import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { AgentActivityItem } from "../runner/json-events";
import type { AgentRunResult } from "../runner/run-result";
import type { AgentToolDetails } from "./agent-tool";
import type { AgentParams, AgentTaskInput } from "./schemas";

const COLLAPSED_ACTIVITY_ITEMS = 3;
const COLLAPSED_OUTPUT_LINES = 3;
const MAX_TASK_PREVIEW = 96;
const MAX_LINE_PREVIEW = 160;

export function renderAgentToolCall(args: AgentParams, theme: Theme): Text {
  return new Text(formatAgentToolCall(args, theme), 0, 0);
}

export function renderAgentToolResult(
  result: AgentToolResult<AgentToolDetails>,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
): Text {
  return new Text(formatAgentToolResult(result, options, theme), 0, 0);
}

export function formatAgentToolCall(args: AgentParams, theme: Theme): string {
  const tasks = Array.isArray(args.tasks) ? args.tasks : [];
  if (tasks.length > 0) {
    return [
      `${theme.fg("toolTitle", theme.bold("Agent "))}${theme.fg("accent", `${tasks.length} subagents in parallel`)}`,
      ...tasks.slice(0, 6).map((task, index) => formatCallTaskLine(task, index, theme)),
      tasks.length > 6 ? `  ${theme.fg("muted", `… +${tasks.length - 6} more`)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const agent = typeof args.subagent_type === "string" && args.subagent_type.trim() ? args.subagent_type.trim() : "…";
  const prompt = typeof args.prompt === "string" ? args.prompt : "";
  const description = typeof args.description === "string" ? args.description.trim() : "";
  return [
    `${theme.fg("toolTitle", theme.bold("Agent "))}${theme.fg("accent", agent)}`,
    `  ${theme.fg("dim", truncate(description || prompt || "Waiting for task arguments…", MAX_TASK_PREVIEW))}`,
  ].join("\n");
}

export function formatAgentToolResult(
  result: AgentToolResult<AgentToolDetails>,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
): string {
  const details = result.details;
  if (!details || details.results.length === 0) return contentText(result) || "No subagent results.";

  const expanded = options.expanded === true;
  const lines: string[] = [formatHeader(details, theme)];
  for (const agentResult of details.results) {
    lines.push("");
    lines.push(...formatAgentResult(agentResult, expanded, theme));
  }

  if (!expanded && details.results.some((agentResult) => agentResult.activity.length > COLLAPSED_ACTIVITY_ITEMS)) {
    lines.push("");
    lines.push(theme.fg("muted", "Press Ctrl+O to see full subagent activity."));
  }

  return lines.join("\n");
}

function formatCallTaskLine(task: AgentTaskInput, index: number, theme: Theme): string {
  const agent = typeof task.subagent_type === "string" && task.subagent_type.trim() ? task.subagent_type.trim() : "…";
  const prompt = typeof task.prompt === "string" ? task.prompt : "";
  const description = typeof task.description === "string" ? task.description.trim() : "";
  return `  ${theme.fg("muted", `${index + 1}.`)} ${theme.fg("accent", agent)} ${theme.fg(
    "dim",
    truncate(description || prompt || "Waiting for task arguments…", MAX_TASK_PREVIEW),
  )}`;
}

function formatHeader(details: AgentToolDetails, theme: Theme): string {
  const counts = countStatuses(details.results);
  if (details.mode === "single") {
    const result = details.results[0];
    return `${statusIcon(result.status, theme)} ${theme.fg("toolTitle", theme.bold("Agent "))}${theme.fg(
      "accent",
      result.agent,
    )} ${theme.fg("muted", result.status)}`;
  }

  const statusParts = [
    `${counts.succeeded}/${details.results.length} completed`,
    counts.failed ? `${counts.failed} failed` : "",
    counts.running ? `${counts.running} running` : "",
    counts.queued ? `${counts.queued} queued` : "",
  ].filter(Boolean);

  return `${batchIcon(counts, theme)} ${theme.fg("toolTitle", theme.bold("Subagents "))}${theme.fg(
    "accent",
    statusParts.join(" · "),
  )}`;
}

function formatAgentResult(result: AgentRunResult, expanded: boolean, theme: Theme): string[] {
  const label = result.description ? `${result.agent} — ${result.description}` : result.agent;
  const lines = [
    `${statusIcon(result.status, theme)} ${theme.fg("accent", label)} ${theme.fg("muted", result.status)}`,
  ];

  if (expanded) lines.push(`  ${theme.fg("muted", "Task:")} ${theme.fg("dim", result.task)}`);

  const activity = expanded ? result.activity : result.activity.slice(-COLLAPSED_ACTIVITY_ITEMS);
  if (activity.length > 0) {
    for (const item of activity) lines.push(`  ${formatActivityItem(item, expanded, theme)}`);
  } else if (result.status === "queued") {
    lines.push(`  ${theme.fg("dim", truncate(result.task, MAX_TASK_PREVIEW))}`);
  } else if (result.status === "running") {
    lines.push(`  ${theme.fg("warning", "starting child Pi…")}`);
  }

  const output = formatOutputPreview(result, expanded, theme);
  if (output) lines.push(output);

  const usage = formatUsage(result);
  if (usage) lines.push(`  ${theme.fg("dim", usage)}`);

  return lines;
}

function formatActivityItem(item: AgentActivityItem, expanded: boolean, theme: Theme): string {
  if (item.kind === "assistant") {
    const text = expanded ? item.text : firstLines(item.text, COLLAPSED_OUTPUT_LINES);
    return `${theme.fg(item.status === "running" ? "warning" : "toolOutput", "assistant:")} ${theme.fg(
      "toolOutput",
      truncate(text, MAX_LINE_PREVIEW),
    )}`;
  }

  const status =
    item.status === "running"
      ? theme.fg("warning", "↻")
      : item.status === "failed"
        ? theme.fg("error", "✗")
        : theme.fg("success", "✓");
  const output = item.outputPreview
    ? ` ${theme.fg("muted", "→")} ${theme.fg("dim", truncate(item.outputPreview, MAX_LINE_PREVIEW))}`
    : "";
  const args = item.argsPreview ? ` ${theme.fg("dim", truncate(item.argsPreview, MAX_LINE_PREVIEW))}` : "";
  return `${status} ${theme.fg("muted", item.toolName)}${args}${output}`;
}

function formatOutputPreview(result: AgentRunResult, expanded: boolean, theme: Theme): string {
  if (result.status === "queued" || result.status === "running") return "";
  if (!result.finalOutput || result.finalOutput === "(no output)") return "";

  const label = result.status === "failed" ? theme.fg("error", "  Error:") : theme.fg("muted", "  Output:");
  const text = expanded ? result.finalOutput : firstLines(result.finalOutput, COLLAPSED_OUTPUT_LINES);
  return `${label} ${theme.fg("toolOutput", truncate(text, MAX_LINE_PREVIEW))}`;
}

function formatUsage(result: AgentRunResult): string {
  const parts: string[] = [];
  if (result.usage.turns) parts.push(`${result.usage.turns} turn${result.usage.turns === 1 ? "" : "s"}`);
  if (result.usage.input) parts.push(`↑${formatTokens(result.usage.input)}`);
  if (result.usage.output) parts.push(`↓${formatTokens(result.usage.output)}`);
  if (result.usage.cacheRead) parts.push(`R${formatTokens(result.usage.cacheRead)}`);
  if (result.usage.cacheWrite) parts.push(`W${formatTokens(result.usage.cacheWrite)}`);
  if (result.usage.cost) parts.push(`$${result.usage.cost.toFixed(4)}`);
  if (result.model) parts.push(result.thinking ? `${result.model} • ${result.thinking}` : result.model);
  else if (result.thinking) parts.push(`thinking: ${result.thinking}`);
  return parts.join(" ");
}

function countStatuses(results: AgentRunResult[]): Record<AgentRunResult["status"], number> {
  return {
    queued: results.filter((result) => result.status === "queued").length,
    running: results.filter((result) => result.status === "running").length,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}

function batchIcon(counts: Record<AgentRunResult["status"], number>, theme: Theme): string {
  if (counts.running || counts.queued) return theme.fg("warning", "⏳");
  if (counts.failed) return theme.fg("warning", "◐");
  return theme.fg("success", "✓");
}

function statusIcon(status: AgentRunResult["status"], theme: Theme): string {
  switch (status) {
    case "queued":
      return theme.fg("dim", "○");
    case "running":
      return theme.fg("warning", "⏳");
    case "succeeded":
      return theme.fg("success", "✓");
    case "failed":
      return theme.fg("error", "✗");
  }
}

function contentText(result: AgentToolResult<AgentToolDetails>): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function firstLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  const shown = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${shown}\n…` : shown;
}

function truncate(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

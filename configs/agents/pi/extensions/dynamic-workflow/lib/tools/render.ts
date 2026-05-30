import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { WorkflowSnapshot, WorkflowToolActivityItem } from "../runtime/types";
import type { WorkflowMeta } from "../script/parse";
import type { WorkflowToolDetails, WorkflowToolInput } from "./workflow-tool";

const COLLAPSED_AGENT_COUNT = 8;
const COLLAPSED_ACTIVITY_COUNT = 3;
const MAX_PREVIEW = 120;

export function createWorkflowSnapshot(
  meta: WorkflowMeta,
  run: { runId?: string; runDir?: string } = {},
): WorkflowSnapshot {
  return {
    name: meta.name,
    description: meta.description,
    runId: run.runId,
    runDir: run.runDir,
    phases: meta.phases?.map((phase) => phase.title) ?? [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
  };
}

export function recomputeWorkflowSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  const runningCount = snapshot.agents.filter((agent) => agent.status === "running").length;
  const succeededCount = snapshot.agents.filter((agent) => agent.status === "succeeded").length;
  const failedCount = snapshot.agents.filter((agent) => agent.status === "failed").length;
  const skippedCount = snapshot.agents.filter((agent) => agent.status === "skipped").length;
  return { ...snapshot, agentCount: snapshot.agents.length, runningCount, succeededCount, failedCount, skippedCount };
}

export function renderWorkflowToolCall(args: WorkflowToolInput, theme: Theme): Text {
  return new Text(formatWorkflowToolCall(args, theme), 0, 0);
}

export function renderWorkflowToolResult(
  result: AgentToolResult<WorkflowToolDetails>,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
): Text {
  return new Text(formatWorkflowToolResult(result, options, theme), 0, 0);
}

export function formatWorkflowToolCall(args: WorkflowToolInput, theme: Theme): string {
  const name = previewWorkflowName(args.script);
  return `${theme.fg("toolTitle", theme.bold("workflow "))}${theme.fg("accent", name || "dynamic")}`;
}

export function formatWorkflowToolResult(
  result: AgentToolResult<WorkflowToolDetails>,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
): string {
  const snapshot = result.details?.snapshot;
  if (!snapshot) return contentText(result) || "No workflow result.";
  return formatWorkflowSnapshot(
    snapshot,
    { expanded: options.expanded === true, completed: !options.isPartial },
    theme,
  );
}

export function formatWorkflowSnapshot(
  snapshot: WorkflowSnapshot,
  options: { expanded?: boolean; completed?: boolean } = {},
  theme: Theme = plainTheme(),
): string {
  const lines = renderWorkflowLines(snapshot, options);
  const title = options.completed ? theme.fg("success", "Workflow completed") : theme.fg("warning", "Workflow running");
  return [title, ...lines].join("\n");
}

export function renderWorkflowLines(snapshot: WorkflowSnapshot, options: { expanded?: boolean } = {}): string[] {
  const failed = snapshot.failedCount ? `, ${snapshot.failedCount} failed` : "";
  const running = snapshot.runningCount ? `, ${snapshot.runningCount} running` : "";
  const skipped = snapshot.skippedCount ? `, ${snapshot.skippedCount} skipped` : "";
  const lines = [
    `◆ Workflow: ${snapshot.name} (${snapshot.succeededCount}/${snapshot.agentCount} done${failed}${running}${skipped})`,
  ];

  if (options.expanded && snapshot.runDir) lines.push(`  run: ${snapshot.runDir}`);

  const phaseNames = snapshot.phases.length
    ? snapshot.phases
    : unique(snapshot.agents.map((agent) => agent.phase).filter((phase): phase is string => Boolean(phase)));
  const rendered = new Set<number>();

  for (const phase of phaseNames) {
    const agents = snapshot.agents.filter((agent) => agent.phase === phase);
    for (const agent of agents) rendered.add(agent.id);
    lines.push(formatPhaseLine(phase, agents, snapshot.currentPhase));
    lines.push(...formatAgentLines(agents, options.expanded === true));
  }

  const unphased = snapshot.agents.filter((agent) => !rendered.has(agent.id));
  if (unphased.length) {
    lines.push("  Unphased");
    lines.push(...formatAgentLines(unphased, options.expanded === true));
  }

  for (const log of snapshot.logs.slice(options.expanded ? -8 : -2)) lines.push(`  log: ${shorten(log, MAX_PREVIEW)}`);
  return lines;
}

export function preview(value: unknown, max = 96): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return shorten(text, max);
}

function formatPhaseLine(phase: string, agents: WorkflowSnapshot["agents"], currentPhase: string | undefined): string {
  const succeeded = agents.filter((agent) => agent.status === "succeeded").length;
  const running = agents.filter((agent) => agent.status === "running").length;
  const failed = agents.filter((agent) => agent.status === "failed").length;
  const skipped = agents.filter((agent) => agent.status === "skipped").length;
  const complete = agents.length > 0 && succeeded + failed + skipped === agents.length;
  const marker = running > 0 || (!complete && currentPhase === phase) ? "▶" : complete ? "✓" : " ";
  return `  ${marker} ${phase} ${succeeded}/${agents.length}${running ? ` · ${running} running` : ""}${failed ? ` · ${failed} failed` : ""}${skipped ? ` · ${skipped} skipped` : ""}`;
}

function formatAgentLines(agents: WorkflowSnapshot["agents"], expanded: boolean): string[] {
  const visibleAgents = expanded ? agents : agents.slice(-COLLAPSED_AGENT_COUNT);
  const lines: string[] = [];
  for (const agent of visibleAgents) {
    lines.push(
      `    #${agent.id} ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${agent.outputPreview ? ` — ${shorten(agent.outputPreview, MAX_PREVIEW)}` : ""}`,
    );
    if (expanded) {
      for (const item of agent.activity.slice(-COLLAPSED_ACTIVITY_COUNT))
        lines.push(`      ${formatActivityItem(item)}`);
      if (agent.outputArtifactPath) lines.push(`      output: ${agent.outputArtifactPath}`);
      if (agent.errorMessage) lines.push(`      error: ${agent.errorMessage}`);
    }
  }
  if (!expanded && agents.length > visibleAgents.length)
    lines.push(`    … ${agents.length - visibleAgents.length} earlier agents`);
  return lines;
}

function formatActivityItem(item: WorkflowSnapshot["agents"][number]["activity"][number]): string {
  if (item.kind === "assistant") return `assistant: ${shorten(item.text, MAX_PREVIEW)}`;
  return `${toolStatusIcon(item)} ${item.toolName}${item.argsPreview ? ` ${shorten(item.argsPreview, MAX_PREVIEW)}` : ""}${item.outputPreview ? ` → ${shorten(item.outputPreview, MAX_PREVIEW)}` : ""}`;
}

function toolStatusIcon(item: WorkflowToolActivityItem): string {
  if (item.status === "running") return "↻";
  if (item.status === "failed") return "✗";
  return "✓";
}

function statusIcon(status: WorkflowSnapshot["agents"][number]["status"]): string {
  switch (status) {
    case "queued":
      return "○";
    case "running":
      return "●";
    case "succeeded":
      return "✓";
    case "failed":
      return "✗";
    case "skipped":
      return "-";
  }
}

function previewWorkflowName(script: string): string {
  const match = script.match(/name\s*:\s*["'`]([^"'`]+)["'`]/);
  return match?.[1] ?? "";
}

function contentText(result: AgentToolResult<WorkflowToolDetails>): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function shorten(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function plainTheme(): Theme {
  return {
    fg: (_name: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    strikethrough: (text: string) => text,
  } as Theme;
}

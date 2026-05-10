import type {
  BlueprintDiscoveryResult,
  BlueprintNode,
  BlueprintNodeResult,
  BlueprintPiActivityItem,
  BlueprintRunProgress,
  BlueprintRunResult,
  LoadedBlueprint,
} from "./types";

export type BlueprintSelectionResult = { ok: true; blueprint: LoadedBlueprint } | { ok: false; message: string };

export function resolveBlueprintSelection(
  discovery: BlueprintDiscoveryResult,
  selection: string,
): BlueprintSelectionResult {
  const exact = discovery.blueprints.find((blueprint) => blueprint.id === selection);
  if (exact) return { ok: true, blueprint: exact };

  const matches = discovery.blueprints.filter((blueprint) => blueprint.name === selection);
  if (matches.length === 1) return { ok: true, blueprint: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      message: `Ambiguous blueprint '${selection}'. Use one of: ${matches.map((blueprint) => blueprint.id).join(", ")}.`,
    };
  }

  const available = discovery.blueprints.map((blueprint) => blueprint.id).join(", ") || "none";
  return { ok: false, message: `Unknown blueprint '${selection}'. Available blueprints: ${available}.` };
}

export function formatBlueprintList(discovery: BlueprintDiscoveryResult): string {
  const lines = ["Blueprints:"];
  if (discovery.blueprints.length === 0) lines.push("  none found");
  for (const blueprint of discovery.blueprints) {
    const description = blueprint.description ? ` — ${blueprint.description}` : "";
    lines.push(`  ${blueprint.id}${description}`);
  }

  if (discovery.errors.length > 0) {
    lines.push("", "Discovery errors:");
    for (const error of discovery.errors) lines.push(`  ${error.filePath}: ${error.message}`);
  }

  if (discovery.blueprints.length === 0 && discovery.errors.length === 0) {
    lines.push("", `Searched: ${discovery.dirs.join(", ") || "no directories"}`);
  }

  return lines.join("\n");
}

export function formatBlueprintProgress(progress: BlueprintRunProgress): string[] {
  const lines = [`Blueprint ${progress.runId}: ${progress.message}`];
  for (const result of progress.results.slice(-5)) {
    const icon = result.status === "success" ? "✓" : "✗";
    lines.push(`${icon} ${result.nodeId} (${result.type}) ${result.status}`);
  }
  lines.push(`Artifacts: ${progress.runDir}`);
  return lines;
}

export function formatBlueprintWorkflow(
  progress: BlueprintRunProgress,
  blueprint: LoadedBlueprint,
  task: string,
): string[] {
  const nodeIds = Object.keys(blueprint.definition.nodes);
  const nodeStates = nodeIds.map((nodeId) => describeNodeState(nodeId, progress));
  const counts = countWorkflowStates(nodeStates);
  const runningNode = nodeStates.find((state) => state.status === "running");
  const headerIcon = progress.status === "failed" ? "✗" : progress.status === "succeeded" ? "✓" : "⏳";
  const countParts = [
    `${counts.succeeded}/${nodeIds.length} done`,
    counts.failed ? `${counts.failed} failed` : "",
    runningNode ? `${runningNode.nodeId} running` : "",
    counts.queued ? `${counts.queued} queued` : "",
  ].filter(Boolean);

  const lines = [
    `${headerIcon} Blueprint ${blueprint.id} — ${progress.status}`,
    blueprint.description ? `  ${truncateInline(blueprint.description, 140)}` : "",
    task ? `  Task: ${truncateInline(task, 140)}` : "",
    `  Run: ${progress.runId}`,
    `  ${countParts.join(" · ")}`,
    progress.message ? `  Now: ${truncateInline(progress.message, 160)}` : "",
    "",
    "Workflow:",
  ].filter(Boolean);

  for (const nodeId of nodeIds) {
    const node = blueprint.definition.nodes[nodeId];
    if (!node) continue;
    const state = describeNodeState(nodeId, progress);
    lines.push(formatWorkflowNodeLine(nodeId, node, state));
    const route = formatNodeRoute(node);
    if (route) lines.push(`  ${route}`);
    const activity = formatPiActivityPreview(state, progress);
    for (const activityLine of activity) lines.push(`  ${activityLine}`);
    const output = formatNodeOutputPreview(state.result);
    if (output) lines.push(`  ${output}`);
  }

  lines.push(`Artifacts: ${progress.runDir}`);
  return lines;
}

export function formatBlueprintRunSummary(result: BlueprintRunResult): string {
  const succeeded = result.results.filter((node) => node.status === "success").length;
  return [
    `Blueprint ${result.blueprint} ${result.status}.`,
    result.message,
    `Nodes: ${succeeded}/${result.results.length} succeeded.`,
    `Artifacts: ${result.runDir}`,
  ].join("\n");
}

type WorkflowNodeStatus = "queued" | "running" | "succeeded" | "failed";

interface WorkflowNodeState {
  nodeId: string;
  status: WorkflowNodeStatus;
  attempt: number;
  result?: BlueprintNodeResult;
  activity?: BlueprintPiActivityItem[];
}

function describeNodeState(nodeId: string, progress: BlueprintRunProgress): WorkflowNodeState {
  const nodeResults = progress.results.filter((result) => result.nodeId === nodeId);
  const lastResult = nodeResults.at(-1);
  const isRunning = progress.status === "running" && progress.currentNodeId === nodeId;

  if (isRunning) {
    return {
      nodeId,
      status: "running",
      attempt: progress.activeNode?.nodeId === nodeId ? progress.activeNode.attempt : (lastResult?.attempt ?? 0) + 1,
      result: lastResult,
      activity: progress.activeNode?.nodeId === nodeId ? progress.activeNode.activity : lastResult?.activity,
    };
  }

  if (!lastResult) return { nodeId, status: "queued", attempt: 0 };
  return {
    nodeId,
    status: lastResult.status === "success" ? "succeeded" : "failed",
    attempt: lastResult.attempt,
    result: lastResult,
    activity: lastResult.activity,
  };
}

function countWorkflowStates(states: WorkflowNodeState[]): Record<WorkflowNodeStatus, number> {
  return {
    queued: states.filter((state) => state.status === "queued").length,
    running: states.filter((state) => state.status === "running").length,
    succeeded: states.filter((state) => state.status === "succeeded").length,
    failed: states.filter((state) => state.status === "failed").length,
  };
}

function formatWorkflowNodeLine(nodeId: string, node: BlueprintNode, state: WorkflowNodeState): string {
  const attempt = state.attempt > 0 ? ` attempt ${state.attempt}` : "";
  const detail = formatNodeDetail(node);
  return `${statusIcon(state.status)} ${nodeId} [${node.type}] ${state.status}${attempt}${detail}`;
}

function formatNodeDetail(node: BlueprintNode): string {
  switch (node.type) {
    case "command":
      return ` — ${truncateInline(node.run, 96)}`;
    case "pi": {
      const parts = [
        node.thinking ? `thinking ${node.thinking}` : "",
        node.tools?.length ? `tools ${node.tools.join(",")}` : "",
        node.skills?.length ? `skills ${node.skills.length}` : "",
      ].filter(Boolean);
      return parts.length > 0 ? ` — ${parts.join(" · ")}` : "";
    }
    case "stop":
      return node.message ? ` — ${truncateInline(node.message, 96)}` : "";
  }
}

function formatNodeRoute(node: BlueprintNode): string {
  if (node.type === "stop") return "";
  const success = node.on?.success ?? node.next;
  const failure = node.on?.failure;
  const parts = [success ? `success → ${success}` : "", failure ? `failure → ${failure}` : ""].filter(Boolean);
  return parts.length > 0 ? `↳ ${parts.join(" · ")}` : "";
}

function formatNodeOutputPreview(result: BlueprintNodeResult | undefined): string {
  if (!result || result.status === "success") return "";
  const firstLine = result.output
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ? `last: ${truncateInline(firstLine, 140)}` : "";
}

function formatPiActivityPreview(state: WorkflowNodeState, progress: BlueprintRunProgress): string[] {
  const activity = state.activity ?? [];
  if (activity.length === 0) return [];

  const expanded = progress.status !== "running" || progress.currentNodeId !== state.nodeId;
  const items = expanded ? activity : activity.slice(-6);
  return items.map(formatPiActivityItem);
}

function formatPiActivityItem(item: BlueprintPiActivityItem): string {
  if (item.kind === "assistant") {
    return `assistant: ${truncateInline(firstLines(item.text, 3), 160)}`;
  }

  const status = item.status === "running" ? "↻" : item.status === "failed" ? "✗" : "✓";
  const args = item.argsPreview ? ` ${truncateInline(item.argsPreview, 160)}` : "";
  const output = item.outputPreview ? ` → ${truncateInline(item.outputPreview, 160)}` : "";
  return `${status} ${item.toolName}${args}${output}`;
}

function firstLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  const shown = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${shown}\n…` : shown;
}

function statusIcon(status: WorkflowNodeStatus): string {
  switch (status) {
    case "queued":
      return "○";
    case "running":
      return "⏳";
    case "succeeded":
      return "✓";
    case "failed":
      return "✗";
  }
}

function truncateInline(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

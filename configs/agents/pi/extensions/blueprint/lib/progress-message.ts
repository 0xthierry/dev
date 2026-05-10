import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { formatBlueprintWorkflow } from "./format";
import type { BlueprintRunProgress, LoadedBlueprint } from "./types";

export const BLUEPRINT_PROGRESS_MESSAGE_TYPE = "blueprint-progress";

export interface BlueprintProgressMessageDetails {
  blueprint: LoadedBlueprint;
  task: string;
  progress: BlueprintRunProgress;
}

export interface BlueprintProgressCustomMessage {
  customType: typeof BLUEPRINT_PROGRESS_MESSAGE_TYPE;
  content: string;
  display: true;
  details: BlueprintProgressMessageDetails;
}

interface BlueprintProgressRenderedMessage {
  role: "custom";
  customType: string;
  content: unknown;
  display: boolean;
  details?: BlueprintProgressMessageDetails;
  timestamp: number;
}

export function blueprintProgressMessage(
  blueprint: LoadedBlueprint,
  task: string,
  progress: BlueprintRunProgress,
): BlueprintProgressCustomMessage {
  return {
    customType: BLUEPRINT_PROGRESS_MESSAGE_TYPE,
    content: `Blueprint ${blueprint.id} ${progress.status}: ${progress.message}`,
    display: true,
    details: { blueprint, task, progress: cloneProgress(progress) },
  };
}

export function publishBlueprintProgressMessage(
  pi: ExtensionAPI,
  blueprint: LoadedBlueprint,
  task: string,
  progress: BlueprintRunProgress,
): void {
  pi.sendMessage(blueprintProgressMessage(blueprint, task, progress));
}

export function renderBlueprintProgressMessage(
  message: BlueprintProgressRenderedMessage,
  options: { expanded: boolean },
  theme: Theme,
) {
  const details = message.details;
  if (!details) return undefined;

  const lines = formatBlueprintProgressMessageLines(details, { expanded: options.expanded });
  const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
  box.addChild(new Text(styleBlueprintProgressLines(lines, theme), 0, 0));
  return box;
}

export function formatBlueprintProgressMessageLines(
  details: BlueprintProgressMessageDetails,
  options: { expanded?: boolean } = {},
): string[] {
  const lines = formatBlueprintWorkflow(details.progress, details.blueprint, details.task);
  if (options.expanded) return lines;

  const header = lines.slice(0, 6);
  const workflowStart = lines.indexOf("Workflow:");
  if (workflowStart === -1) return lines.slice(0, 12);

  const nodeLines = lines
    .slice(workflowStart + 1)
    .filter((line) => /^[○⏳✓✗] /.test(line))
    .slice(0, 8);
  const artifacts = lines.find((line) => line.startsWith("Artifacts:"));
  const hasMoreNodes =
    lines.slice(workflowStart + 1).filter((line) => /^[○⏳✓✗] /.test(line)).length > nodeLines.length;

  return [
    ...header,
    "Workflow:",
    ...nodeLines,
    hasMoreNodes ? "… expand for full workflow details" : "",
    artifacts ?? "",
  ].filter(Boolean);
}

function cloneProgress(progress: BlueprintRunProgress): BlueprintRunProgress {
  return {
    ...progress,
    results: progress.results.map((result) => ({ ...result })),
  };
}

function styleBlueprintProgressLines(lines: string[], theme: Theme): string {
  return lines.map((line) => styleBlueprintProgressLine(line, theme)).join("\n");
}

function styleBlueprintProgressLine(line: string, theme: Theme): string {
  if (line.startsWith("⏳ Blueprint") || line.startsWith("✓ Blueprint") || line.startsWith("✗ Blueprint")) {
    return line.replace("Blueprint", theme.fg("toolTitle", theme.bold("Blueprint")));
  }
  if (line.startsWith("⏳ ")) return theme.fg("warning", "⏳") + line.slice(1);
  if (line.startsWith("✓ ")) return theme.fg("success", "✓") + line.slice(1);
  if (line.startsWith("✗ ")) return theme.fg("error", "✗") + line.slice(1);
  if (line.startsWith("○ ")) return theme.fg("dim", "○") + line.slice(1);
  if (line.startsWith("Workflow:")) return theme.fg("muted", line);
  if (line.startsWith("Artifacts:")) return theme.fg("dim", line);
  if (line.trimStart().startsWith("↳")) return theme.fg("muted", line);
  if (line.trimStart().startsWith("last:")) return theme.fg("warning", line);
  if (line.startsWith("…")) return theme.fg("muted", line);
  return line;
}

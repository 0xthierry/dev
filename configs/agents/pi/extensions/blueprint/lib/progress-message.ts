import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text } from "@earendil-works/pi-tui";
import { formatBlueprintWorkflow } from "./format";
import type { BlueprintRunProgress, LoadedBlueprint } from "./types";

export const BLUEPRINT_PROGRESS_MESSAGE_TYPE = "blueprint-progress";

export interface BlueprintProgressMessageDetails {
  blueprint: LoadedBlueprint;
  task: string;
  progress: BlueprintRunProgress;
  liveId?: string;
  ephemeral?: boolean;
  superseded?: boolean;
}

export interface BlueprintProgressCustomMessage {
  customType: typeof BLUEPRINT_PROGRESS_MESSAGE_TYPE;
  content: string;
  display: true;
  details: BlueprintProgressMessageDetails;
}

export interface BlueprintProgressMessageHandle {
  details: BlueprintProgressMessageDetails;
  publish(): void;
  update(progress: BlueprintRunProgress): void;
  finish(progress: BlueprintRunProgress): void;
}

interface BlueprintProgressRenderedMessage {
  role: "custom";
  customType: string;
  content: unknown;
  display: boolean;
  details?: BlueprintProgressMessageDetails;
  timestamp: number;
}

const liveProgressDetails = new Map<string, BlueprintProgressMessageDetails>();
let nextLiveProgressId = 0;

export function blueprintProgressMessage(
  blueprint: LoadedBlueprint,
  task: string,
  progress: BlueprintRunProgress,
): BlueprintProgressCustomMessage {
  return blueprintProgressMessageFromDetails({ blueprint, task, progress: cloneProgress(progress) });
}

export function createBlueprintProgressMessageHandle(
  pi: ExtensionAPI,
  blueprint: LoadedBlueprint,
  task: string,
  progress: BlueprintRunProgress,
): BlueprintProgressMessageHandle {
  const liveId = `blueprint-${Date.now()}-${++nextLiveProgressId}`;
  const details: BlueprintProgressMessageDetails = {
    blueprint,
    task,
    progress: cloneProgress(progress),
    liveId,
    ephemeral: true,
  };
  let published = false;

  return {
    details,
    publish() {
      if (published) return;
      published = true;
      liveProgressDetails.set(liveId, details);
      pi.sendMessage(blueprintProgressLiveMessageFromDetails(details));
    },
    update(nextProgress) {
      details.progress = cloneProgress(nextProgress);
      if (published && !details.superseded) liveProgressDetails.set(liveId, details);
    },
    finish(nextProgress) {
      details.progress = cloneProgress(nextProgress);
      details.superseded = true;
      liveProgressDetails.delete(liveId);
    },
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

function blueprintProgressMessageFromDetails(details: BlueprintProgressMessageDetails): BlueprintProgressCustomMessage {
  return {
    customType: BLUEPRINT_PROGRESS_MESSAGE_TYPE,
    content: `Blueprint ${details.blueprint.id} ${details.progress.status}: ${details.progress.message}`,
    display: true,
    details,
  };
}

function blueprintProgressLiveMessageFromDetails(
  details: BlueprintProgressMessageDetails,
): BlueprintProgressCustomMessage {
  return {
    ...blueprintProgressMessageFromDetails(details),
    content: `Blueprint ${details.blueprint.id} live progress card for task: ${details.task}`,
  };
}

export function renderBlueprintProgressMessage(
  message: BlueprintProgressRenderedMessage,
  options: { expanded: boolean },
  theme: Theme,
) {
  const details = message.details;
  if (!details) return new EmptyBlueprintProgressMessage();

  const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
  box.addChild(new BlueprintProgressMessageText(details, { expanded: options.expanded }, theme));
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

  const artifacts = lines.find((line) => line.startsWith("Artifacts:"));
  const workflowLines = lines.slice(workflowStart + 1).filter((line) => !line.startsWith("Artifacts:"));
  const shownWorkflowLines = workflowLines.slice(0, 14);
  const hasMoreWorkflow = workflowLines.length > shownWorkflowLines.length;

  return [
    ...header,
    "Workflow:",
    ...shownWorkflowLines,
    hasMoreWorkflow ? "… expand for full workflow details" : "",
    artifacts ?? "",
  ].filter(Boolean);
}

function cloneProgress(progress: BlueprintRunProgress): BlueprintRunProgress {
  return {
    ...progress,
    results: progress.results.map((result) => ({ ...result, activity: result.activity?.map((item) => ({ ...item })) })),
    activeNode: progress.activeNode
      ? { ...progress.activeNode, activity: progress.activeNode.activity?.map((item) => ({ ...item })) }
      : undefined,
  };
}

function resolveRenderableProgressDetails(
  details: BlueprintProgressMessageDetails | undefined,
): BlueprintProgressMessageDetails | undefined {
  if (!details) return undefined;
  if (!details.ephemeral) return details;
  if (details.liveId) return liveProgressDetails.get(details.liveId);
  return undefined;
}

class EmptyBlueprintProgressMessage implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

class BlueprintProgressMessageText implements Component {
  constructor(
    private readonly details: BlueprintProgressMessageDetails,
    private readonly options: { expanded: boolean },
    private readonly theme: Theme,
  ) {}

  render(width: number): string[] {
    const details = resolveRenderableProgressDetails(this.details);
    if (!details) return [];

    const lines = formatBlueprintProgressMessageLines(details, { expanded: this.options.expanded });
    return new Text(styleBlueprintProgressLines(lines, this.theme), 0, 0).render(width);
  }

  invalidate(): void {}
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
  if (line.trimStart().startsWith("assistant:")) return theme.fg("toolOutput", line);
  if (line.trimStart().startsWith("↻")) return theme.fg("warning", line);
  if (line.trimStart().startsWith("✓")) return theme.fg("success", line);
  if (line.trimStart().startsWith("✗")) return theme.fg("error", line);
  if (line.trimStart().startsWith("last:")) return theme.fg("warning", line);
  if (line.startsWith("…")) return theme.fg("muted", line);
  return line;
}

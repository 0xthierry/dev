import { Text } from "@earendil-works/pi-tui";
import type { GrepResult, SearchResult } from "./types";

const GREP_MAX_LINE_LENGTH = 500;
const HOT_FRECENCY = 25;
const WARM_FRECENCY = 20;
const FIND_WEAK_SAMPLE_SIZE = 5;

export type FileAnnotationInput = {
  gitStatus?: string;
  totalFrecencyScore?: number;
  accessFrecencyScore?: number;
};

export type FormattedFind = {
  output: string;
  weak: boolean;
  shownCount: number;
};

export function fffFileAnnotation(item: FileAnnotationInput): string {
  const git = item.gitStatus;
  if (git && git !== "clean" && git !== "unknown") return `  [${git} in git]`;

  const frecency = item.totalFrecencyScore ?? item.accessFrecencyScore ?? 0;
  if (frecency >= HOT_FRECENCY) return "  [VERY often touched file]";
  if (frecency >= WARM_FRECENCY) return "  [often touched file]";

  return "";
}

export function formatGrepOutput(result: GrepResult): string {
  if (result.items.length === 0) return "No matches found";

  const lines: string[] = [];
  let currentFile = "";

  for (const match of result.items) {
    if (match.relativePath !== currentFile) {
      if (lines.length > 0) lines.push("");
      currentFile = match.relativePath;
      lines.push(`${currentFile}${fffFileAnnotation(match)}`);
    }

    match.contextBefore?.forEach((line, index) => {
      const lineNumber = match.lineNumber - (match.contextBefore?.length ?? 0) + index;
      lines.push(` ${lineNumber}- ${truncateGrepLine(line)}`);
    });

    lines.push(` ${match.lineNumber}: ${truncateGrepLine(match.lineContent)}`);

    match.contextAfter?.forEach((line, index) => {
      const lineNumber = match.lineNumber + index + 1;
      lines.push(` ${lineNumber}- ${truncateGrepLine(line)}`);
    });
  }

  return lines.join("\n");
}

export function formatFindOutput(result: SearchResult, limit: number, pattern: string): FormattedFind {
  if (result.items.length === 0) {
    return { output: "No files found matching pattern", weak: false, shownCount: 0 };
  }

  const topScore = result.scores[0]?.total ?? 0;
  const weak = topScore < weakScoreThreshold(pattern);
  const effectiveLimit = weak ? Math.min(FIND_WEAK_SAMPLE_SIZE, limit) : limit;
  const shown = result.items.slice(0, effectiveLimit);

  return {
    output: shown.map((item) => `${item.relativePath}${fffFileAnnotation(item)}`).join("\n"),
    weak,
    shownCount: shown.length,
  };
}

export function renderTextResult(
  result: { content?: { type: string; text?: string }[] },
  options: { expanded?: boolean },
  theme: { fg: (name: "muted" | "toolOutput", text: string) => string },
  context: { lastComponent?: unknown },
  maxLines: number,
): Text {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  const output = result.content?.find((content) => content.type === "text")?.text?.trim() ?? "";
  if (!output) {
    text.setText(theme.fg("muted", "No output"));
    return text;
  }

  const lines = output.split("\n");
  const displayLines = lines.slice(0, options.expanded ? lines.length : maxLines);
  let content = `\n${displayLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;
  if (lines.length > displayLines.length) {
    content += theme.fg("muted", `\n... (${lines.length - displayLines.length} more lines)`);
  }
  text.setText(content);
  return text;
}

function truncateGrepLine(line: string, max = GREP_MAX_LINE_LENGTH): string {
  const trimmed = line.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}...`;
}

function weakScoreThreshold(pattern: string): number {
  const perfect = pattern.length * 12;
  return Math.floor((perfect * 50) / 100);
}

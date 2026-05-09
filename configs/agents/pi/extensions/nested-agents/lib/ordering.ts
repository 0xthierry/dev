import type { AgentsContextFile } from "./types";

const FILENAME_PRIORITY = new Map([
  ["AGENTS.md", 0],
  ["AGENTS.MD", 1],
  ["CLAUDE.md", 2],
  ["CLAUDE.MD", 3],
]);

export function sortAgentsContextFiles(files: AgentsContextFile[]): AgentsContextFile[] {
  return [...files].sort(compareAgentsContextFiles);
}

function compareAgentsContextFiles(left: AgentsContextFile, right: AgentsContextFile): number {
  const scopeComparison = comparePathSegments(scopeSegments(left.relativePath), scopeSegments(right.relativePath));
  if (scopeComparison !== 0) return scopeComparison;

  const filenameComparison = filenamePriority(left.filename) - filenamePriority(right.filename);
  if (filenameComparison !== 0) return filenameComparison;

  return compareStrings(left.relativePath, right.relativePath);
}

function scopeSegments(relativePath: string): string[] {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.slice(0, -1);
}

function comparePathSegments(left: string[], right: string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareStrings(left[index] ?? "", right[index] ?? "");
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function filenamePriority(filename: string): number {
  return FILENAME_PRIORITY.get(filename) ?? Number.MAX_SAFE_INTEGER;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

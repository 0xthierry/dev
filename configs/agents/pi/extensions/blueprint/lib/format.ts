import type { BlueprintDiscoveryResult, BlueprintRunProgress, BlueprintRunResult, LoadedBlueprint } from "./types";

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

export function formatBlueprintRunSummary(result: BlueprintRunResult): string {
  const succeeded = result.results.filter((node) => node.status === "success").length;
  return [
    `Blueprint ${result.blueprint} ${result.status}.`,
    result.message,
    `Nodes: ${succeeded}/${result.results.length} succeeded.`,
    `Artifacts: ${result.runDir}`,
  ].join("\n");
}

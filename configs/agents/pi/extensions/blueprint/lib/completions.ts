import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { BlueprintRuntime } from "./runtime";
import type { LoadedBlueprint } from "./types";

export async function getBlueprintArgumentCompletions(
  runtime: BlueprintRuntime,
  cwd: string,
  argumentPrefix: string,
): Promise<AutocompleteItem[] | null> {
  const leadingTrimmed = argumentPrefix.trimStart();
  if (/\s/.test(leadingTrimmed)) return null;

  const partial = leadingTrimmed;
  const discovery = await runtime.discoverBlueprints(cwd);
  const items = buildBlueprintCompletionItems(discovery.blueprints);
  const filtered = items.filter((item) => item.value.startsWith(partial));
  return filtered.length > 0 ? filtered : null;
}

export function buildBlueprintCompletionItems(blueprints: LoadedBlueprint[]): AutocompleteItem[] {
  const nameCounts = countBlueprintNames(blueprints);
  const items: AutocompleteItem[] = [{ value: "list", label: "list", description: "List discovered blueprints" }];

  for (const blueprint of blueprints) {
    items.push({ value: blueprint.id, label: blueprint.id, description: blueprint.description || blueprint.filePath });
    if (nameCounts.get(blueprint.name) === 1) {
      items.push({
        value: blueprint.name,
        label: blueprint.name,
        description: `${blueprint.scope}: ${blueprint.description || blueprint.filePath}`,
      });
    }
  }

  return items.sort((a, b) => a.value.localeCompare(b.value));
}

function countBlueprintNames(blueprints: LoadedBlueprint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const blueprint of blueprints) counts.set(blueprint.name, (counts.get(blueprint.name) ?? 0) + 1);
  return counts;
}

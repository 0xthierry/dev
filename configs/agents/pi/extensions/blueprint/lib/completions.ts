import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { BlueprintRuntime } from "./runtime";
import type { LoadedBlueprint } from "./types";

export function createBlueprintAutocompleteProvider(
  current: AutocompleteProvider,
  runtime: BlueprintRuntime,
  cwd: string,
): AutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const argumentText = extractBlueprintArgumentText(lines[cursorLine] ?? "", cursorCol);
      if (argumentText === null) return current.getSuggestions(lines, cursorLine, cursorCol, options);

      const items = await getBlueprintArgumentCompletions(runtime, cwd, argumentText);
      if (!items) return current.getSuggestions(lines, cursorLine, cursorCol, options);
      return { items, prefix: argumentText };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      const argumentText = extractBlueprintArgumentText(lines[cursorLine] ?? "", cursorCol);
      if (argumentText !== null) return true;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}

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

function extractBlueprintArgumentText(line: string, cursorCol: number): string | null {
  const beforeCursor = line.slice(0, cursorCol);
  const match = beforeCursor.match(/^\/blueprint(?::\d+)?(?:\s+(.*))$/);
  return match ? (match[1] ?? "") : null;
}

function countBlueprintNames(blueprints: LoadedBlueprint[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const blueprint of blueprints) counts.set(blueprint.name, (counts.get(blueprint.name) ?? 0) + 1);
  return counts;
}

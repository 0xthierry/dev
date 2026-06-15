import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { MixedItem } from "./types";

const MENTION_MAX_RESULTS = 20;

export type MentionSearch = (query: string, signal: AbortSignal) => Promise<MixedItem[]>;

export function createFffAutocompleteProviderFactory(
  search: MentionSearch,
): (current: AutocompleteProvider) => AutocompleteProvider {
  const mentionProvider = createFffMentionProvider(search);

  return (current) => ({
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      try {
        const result = await mentionProvider.getSuggestions(lines, cursorLine, cursorCol, options);
        if (result) return result;
      } catch {
        // FFF is an optimization for mentions. If it is not ready, preserve Pi's provider.
      }

      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },

    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  });
}

export function createFffMentionProvider(search: MentionSearch): AutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options) {
      const currentLine = lines[cursorLine] ?? "";
      const prefix = extractAtPrefix(currentLine.slice(0, cursorCol));
      if (!prefix || options.signal.aborted) return null;

      const query = prefix.startsWith('@"') ? prefix.slice(2) : prefix.slice(1);
      const items = toAutocompleteItems((await search(query, options.signal)).slice(0, MENTION_MAX_RESULTS));

      return options.signal.aborted || items.length === 0 ? null : { items, prefix };
    },

    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const currentLine = lines[cursorLine] ?? "";
      const before = currentLine.slice(0, cursorCol - prefix.length);
      const after = currentLine.slice(cursorCol);
      const nextLine = before + item.value + after;

      return {
        lines: [...lines.slice(0, cursorLine), nextLine, ...lines.slice(cursorLine + 1)],
        cursorLine,
        cursorCol: cursorCol - prefix.length + item.value.length,
      };
    },
  };
}

export function extractAtPrefix(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
  return match?.[1] ?? null;
}

export function buildAtCompletionValue(path: string): string {
  return path.includes(" ") ? `@"${path}"` : `@${path}`;
}

function toAutocompleteItems(items: MixedItem[]): AutocompleteItem[] {
  return items.map((mixed) => {
    if (mixed.type === "directory") {
      return {
        value: buildAtCompletionValue(mixed.item.relativePath),
        label: mixed.item.dirName,
        description: mixed.item.relativePath,
      };
    }

    return {
      value: buildAtCompletionValue(mixed.item.relativePath),
      label: mixed.item.fileName,
      description: mixed.item.relativePath,
    };
  });
}

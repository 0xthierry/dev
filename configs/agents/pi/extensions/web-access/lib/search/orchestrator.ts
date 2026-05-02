import { isBraveConfigured, searchWithBrave } from "../providers/brave";
import { searchWithCodex } from "../providers/codex";
import { isExaConfigured, searchWithExa } from "../providers/exa";
import { isTavilyConfigured, searchWithTavily } from "../providers/tavily";
import { isAbortError } from "../shared/errors";
import type { SearchOptions, SearchResponse } from "../types";

export interface SearchProvider {
  name: string;
  unavailableMessage: string;
  isAvailable: () => boolean;
  search: (query: string, options: SearchOptions) => Promise<SearchResponse>;
}

export function defaultSearchProviders(): SearchProvider[] {
  return [
    {
      name: "Exa",
      unavailableMessage: "Exa: API key not configured",
      isAvailable: isExaConfigured,
      search: searchWithExa,
    },
    {
      name: "Brave",
      unavailableMessage: "Brave: API key not configured",
      isAvailable: isBraveConfigured,
      search: searchWithBrave,
    },
    {
      name: "Tavily",
      unavailableMessage: "Tavily: API key not configured",
      isAvailable: isTavilyConfigured,
      search: searchWithTavily,
    },
    {
      name: "Codex",
      unavailableMessage: "Codex: available as fallback",
      isAvailable: () => true,
      search: searchWithCodex,
    },
  ];
}

export async function search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  return searchWithProviderChain(query, options, defaultSearchProviders());
}

export async function searchWithProviderChain(
  query: string,
  options: SearchOptions = {},
  providers: SearchProvider[],
): Promise<SearchResponse> {
  const errors: string[] = [];

  for (const provider of providers) {
    if (!provider.isAvailable()) {
      errors.push(provider.unavailableMessage);
      continue;
    }

    try {
      const result = await provider.search(query, options);
      if (result.results.length === 0) {
        const reason =
          result.answer.trim().length > 0 ? "returned no source URLs" : "returned no answer or source URLs";
        throw new Error(reason);
      }
      return result;
    } catch (err) {
      if (isAbortError(err)) throw err;
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Web search failed:\n  - ${errors.join("\n  - ")}`);
}

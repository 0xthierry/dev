import { searchWithCodex } from "../providers/codex";
import { isExaConfigured, searchWithExa } from "../providers/exa";
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
      return await provider.search(query, options);
    } catch (err) {
      if (isAbortError(err)) throw err;
      errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Web search failed:\n  - ${errors.join("\n  - ")}`);
}

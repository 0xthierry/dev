import { getMediumAuthHeaders, isMediumUrl } from "../providers/medium-cookies";
import type { ExtractedContent } from "../types";
import { extractViaHttp } from "./http";
import type { FetchTarget } from "./target";

export interface AuthenticatedHeaderProvider {
  name: string;
  supports(target: FetchTarget): boolean;
  getHeaders(target: FetchTarget, signal?: AbortSignal): Promise<Record<string, string> | null>;
  isHeaderAllowedForUrl(url: URL): boolean;
}

const mediumHeaderProvider: AuthenticatedHeaderProvider = {
  name: "medium",
  supports: (target) => target.requestKind === "content" && isMediumUrl(target.parsedUrl),
  getHeaders: async (target) => getMediumAuthHeaders(target.parsedUrl),
  isHeaderAllowedForUrl: isMediumUrl,
};

export function createDefaultAuthenticatedHeaderProviders(): AuthenticatedHeaderProvider[] {
  return [mediumHeaderProvider];
}

export async function extractViaAuthenticatedHttp(
  target: FetchTarget,
  signal?: AbortSignal,
  providers: AuthenticatedHeaderProvider[] = createDefaultAuthenticatedHeaderProviders(),
): Promise<ExtractedContent | null> {
  for (const provider of providers) {
    if (!provider.supports(target)) continue;

    const headers = await provider.getHeaders(target, signal);
    if (!headers || Object.keys(headers).length === 0) continue;

    return extractViaHttp(target.url, signal, {
      headers,
      isHeaderAllowedForUrl: provider.isHeaderAllowedForUrl,
    });
  }

  return null;
}

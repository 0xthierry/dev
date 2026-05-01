import { loadConfig, normalizedBoolean, normalizedString, type WebSearchConfig } from "../config";
import { type CookieMap, getBrowserCookies } from "./chrome-cookies";

export interface MediumConfig {
  enabled: boolean;
  profile?: string;
}

export function normalizeMediumConfig(raw: WebSearchConfig["medium"] = {}): MediumConfig {
  return {
    enabled: normalizedBoolean(raw.enabled, false),
    profile: normalizedString(raw.profile),
  };
}

function toUrl(value: string | URL): URL | null {
  if (value instanceof URL) return value;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isMediumUrl(value: string | URL): boolean {
  const parsed = toUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return host === "medium.com" || host.endsWith(".medium.com");
}

export function mediumCookieHostsForUrl(value: string | URL): string[] {
  const parsed = toUrl(value);
  if (!parsed || !isMediumUrl(parsed)) return [];
  const host = parsed.hostname.toLowerCase();
  return host === "medium.com" ? ["medium.com"] : ["medium.com", host];
}

export function buildCookieHeader(cookies: CookieMap): string | null {
  const parts = Object.entries(cookies)
    .filter((entry): entry is [string, string] => entry[0].trim().length > 0 && entry[1].trim().length > 0)
    .map(([name, value]) => `${name.trim()}=${value.trim()}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

export function mediumCookieProfileCandidates(
  config: WebSearchConfig,
  mediumConfig: MediumConfig,
): Array<string | undefined> {
  if (mediumConfig.profile) return [mediumConfig.profile];

  const candidates: Array<string | undefined> = [];
  for (const profile of [normalizedString(config.braveProfile), normalizedString(config.chromeProfile), undefined]) {
    if (!candidates.includes(profile)) candidates.push(profile);
  }
  return candidates;
}

export async function getMediumAuthHeaders(value: string | URL): Promise<Record<string, string> | null> {
  const config = loadConfig();
  const mediumConfig = normalizeMediumConfig(config.medium);
  if (!mediumConfig.enabled || !isMediumUrl(value)) return null;

  const hosts = mediumCookieHostsForUrl(value);
  for (const profile of mediumCookieProfileCandidates(config, mediumConfig)) {
    const result = await getBrowserCookies({ hosts, profile });
    if (!result) continue;

    const cookieHeader = buildCookieHeader(result.cookies);
    if (cookieHeader) return { Cookie: cookieHeader };
  }

  return null;
}

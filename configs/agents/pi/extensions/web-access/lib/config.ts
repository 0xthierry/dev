import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");
export const CONFIG_DISPLAY_PATH = "~/.pi/web-search.json";

export interface WebSearchConfig {
  $schema?: unknown;
  exaApiKey?: unknown;
  exaApiKeyEnv?: unknown;
  braveApiKey?: unknown;
  braveApiKeyEnv?: unknown;
  tavilyApiKey?: unknown;
  tavilyApiKeyEnv?: unknown;
  provider?: unknown;
  chromeProfile?: unknown;
  braveProfile?: unknown;
  searchModel?: unknown;
  youtube?: { enabled?: unknown; preferredModel?: unknown };
  medium?: { enabled?: unknown; profile?: unknown };
  githubClone?: {
    enabled?: unknown;
    maxRepoSizeMB?: unknown;
    cloneTimeoutSeconds?: unknown;
    clonePath?: unknown;
  };
}

export function clearConfigCache(): void {
  // loadConfig reads the file on every call so external config edits are picked up immediately.
}

export function loadConfigFromPath(path: string, displayPath = path): WebSearchConfig {
  if (!existsSync(path)) return {};

  const raw = readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw) as WebSearchConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${displayPath}: ${message}`);
  }
}

export function loadConfig(): WebSearchConfig {
  return loadConfigFromPath(CONFIG_PATH, CONFIG_DISPLAY_PATH);
}

export function saveConfig(updates: Partial<WebSearchConfig>): void {
  let config: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${CONFIG_DISPLAY_PATH}: ${message}`);
    }
  }

  Object.assign(config, updates);
  const dir = join(homedir(), ".pi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

export function normalizedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizedPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

export function normalizedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function getConfiguredEnvValue(envName: unknown, defaultName: string): string | undefined {
  const configuredName = normalizedString(envName) ?? defaultName;
  return normalizedString(process.env[configuredName]);
}

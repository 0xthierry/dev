import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

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

let cachedConfig: WebSearchConfig | null = null;

export function clearConfigCache(): void {
  cachedConfig = null;
}

export function loadConfig(): WebSearchConfig {
  if (cachedConfig) return cachedConfig;
  if (!existsSync(CONFIG_PATH)) {
    cachedConfig = {};
    return cachedConfig;
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  try {
    cachedConfig = JSON.parse(raw) as WebSearchConfig;
    return cachedConfig;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
  }
}

export function saveConfig(updates: Partial<WebSearchConfig>): void {
  let config: Record<string, unknown> = {};
  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }
  }

  Object.assign(config, updates);
  const dir = join(homedir(), ".pi");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  cachedConfig = config as WebSearchConfig;
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

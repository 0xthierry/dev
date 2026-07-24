import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeBrowserName, type SupportedBrowser } from "./providers/chatgpt/browser-cookies";

export const ORACLE_CONFIG_PATH = join(homedir(), ".pi", "oracle.json");
export const ORACLE_CONFIG_DISPLAY_PATH = "~/.pi/oracle.json";
export const DEFAULT_ORACLE_MODEL = "gpt-5-6-sol-pro";
const PREVIOUS_DEFAULT_ORACLE_MODEL = "gpt-5-5-pro";
export const DEFAULT_ORACLE_BROWSER: SupportedBrowser = "Chrome";
export const DEFAULT_ORACLE_PROFILE = "Default";
export const DEFAULT_ORACLE_TIMEOUT_MS = 1_800_000;
export const DEFAULT_ORACLE_POLL_INTERVAL_MS = 3_000;

export interface OracleConfig {
  $schema?: unknown;
  chatgpt?: {
    browser?: unknown;
    profile?: unknown;
    model?: unknown;
    projectId?: unknown;
    timeoutMs?: unknown;
    pollIntervalMs?: unknown;
  };
}

export interface NormalizedOracleConfig {
  chatgpt: NormalizedChatGptOracleConfig;
}

export interface NormalizedChatGptOracleConfig {
  browser: SupportedBrowser;
  profile: string;
  model: string;
  projectId?: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

export function loadOracleConfigFromPath(path: string, displayPath = path): OracleConfig {
  if (!existsSync(path)) return {};

  const raw = readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw) as OracleConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${displayPath}: ${message}`);
  }
}

export function loadOracleConfig(): OracleConfig {
  return loadOracleConfigFromPath(ORACLE_CONFIG_PATH, ORACLE_CONFIG_DISPLAY_PATH);
}

export function normalizeOracleConfig(config: OracleConfig): NormalizedOracleConfig {
  const chatgpt = config.chatgpt ?? {};
  const projectId = normalizedProjectId(chatgpt.projectId);
  return {
    chatgpt: {
      browser: normalizeConfiguredBrowser(chatgpt.browser),
      profile: normalizedString(chatgpt.profile) ?? DEFAULT_ORACLE_PROFILE,
      model: normalizedOracleModel(chatgpt.model),
      ...(projectId ? { projectId } : {}),
      timeoutMs: normalizedPositiveInteger(chatgpt.timeoutMs, DEFAULT_ORACLE_TIMEOUT_MS),
      pollIntervalMs: normalizedPositiveInteger(chatgpt.pollIntervalMs, DEFAULT_ORACLE_POLL_INTERVAL_MS),
    },
  };
}

export function normalizedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizedPositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizedOracleModel(value: unknown): string {
  const model = normalizedString(value);
  return !model || model === PREVIOUS_DEFAULT_ORACLE_MODEL ? DEFAULT_ORACLE_MODEL : model;
}

function normalizeConfiguredBrowser(value: unknown): SupportedBrowser {
  const raw = normalizedString(value);
  if (!raw) return DEFAULT_ORACLE_BROWSER;
  const browser = normalizeBrowserName(raw);
  if (browser) return browser;
  throw new Error(
    `Invalid ${ORACLE_CONFIG_DISPLAY_PATH} chatgpt.browser value: ${JSON.stringify(
      raw,
    )}. Use one of: Brave, Chromium, Chrome.`,
  );
}

function normalizedProjectId(value: unknown): string | undefined {
  const raw = normalizedString(value);
  if (!raw) return undefined;
  if (/^g-p-[A-Za-z0-9_-]+$/.test(raw)) return raw;
  throw new Error(
    `Invalid ${ORACLE_CONFIG_DISPLAY_PATH} chatgpt.projectId value: ${JSON.stringify(
      raw,
    )}. Expected a ChatGPT project id like g-p-...`,
  );
}

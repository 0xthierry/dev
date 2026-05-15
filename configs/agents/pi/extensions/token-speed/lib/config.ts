import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TOKEN_SPEED_CONFIG, TOKEN_SPEED_CONFIG_KEY } from "./constants";
import type { TokenSpeedConfig, TokenSpeedConfigResult } from "./types";
import { hasAscendingThresholds, isTokenSpeedDisplay, isValidHexColor } from "./validation";

const SETTINGS_DISPLAY_PATH = "~/.pi/agent/settings.json";

type NumberConfigKey = "tpsSlow" | "tpsMedium" | "tpsFast" | "tpsBlazing";
type ColorConfigKey = "colorSlow" | "colorMedium" | "colorFast" | "colorBlazing";

const NUMBER_CONFIG_KEYS = [
  "tpsSlow",
  "tpsMedium",
  "tpsFast",
  "tpsBlazing",
] as const satisfies readonly NumberConfigKey[];
const COLOR_CONFIG_KEYS = [
  "colorSlow",
  "colorMedium",
  "colorFast",
  "colorBlazing",
] as const satisfies readonly ColorConfigKey[];

export function getTokenSpeedSettingsPath(): string {
  return join(homedir(), ".pi", "agent", "settings.json");
}

export function readTokenSpeedConfig(
  settingsPath = getTokenSpeedSettingsPath(),
  displayPath = SETTINGS_DISPLAY_PATH,
): TokenSpeedConfigResult {
  if (!existsSync(settingsPath)) return resolveTokenSpeedConfig(undefined);

  try {
    return resolveTokenSpeedConfig(JSON.parse(readFileSync(settingsPath, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: { ...DEFAULT_TOKEN_SPEED_CONFIG },
      warnings: [`[token-speed] Could not read ${displayPath}; using defaults. ${message}`],
    };
  }
}

export function resolveTokenSpeedConfig(settings: unknown): TokenSpeedConfigResult {
  const config: TokenSpeedConfig = { ...DEFAULT_TOKEN_SPEED_CONFIG };
  const warnings: string[] = [];

  if (settings == null) return { config, warnings };
  if (!isRecord(settings)) {
    return {
      config,
      warnings: [`[token-speed] Expected ${TOKEN_SPEED_CONFIG_KEY} settings to live in an object; using defaults.`],
    };
  }

  const rawSection = settings[TOKEN_SPEED_CONFIG_KEY];
  if (rawSection == null) return { config, warnings };
  if (!isRecord(rawSection)) {
    return {
      config,
      warnings: [`[token-speed] ${TOKEN_SPEED_CONFIG_KEY} must be an object; using defaults.`],
    };
  }

  for (const key of NUMBER_CONFIG_KEYS) {
    const value = rawSection[key];
    if (value == null) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      config[key] = value;
      continue;
    }
    warnings.push(`[token-speed] ${TOKEN_SPEED_CONFIG_KEY}.${key} must be a finite number; using ${config[key]}.`);
  }

  if (!hasAscendingThresholds(config)) {
    config.tpsSlow = DEFAULT_TOKEN_SPEED_CONFIG.tpsSlow;
    config.tpsMedium = DEFAULT_TOKEN_SPEED_CONFIG.tpsMedium;
    config.tpsFast = DEFAULT_TOKEN_SPEED_CONFIG.tpsFast;
    config.tpsBlazing = DEFAULT_TOKEN_SPEED_CONFIG.tpsBlazing;
    warnings.push(
      `[token-speed] TPS thresholds must be ascending; using defaults ${config.tpsSlow} < ${config.tpsMedium} < ${config.tpsFast} < ${config.tpsBlazing}.`,
    );
  }

  for (const key of COLOR_CONFIG_KEYS) {
    const value = rawSection[key];
    if (value == null) continue;
    if (isValidHexColor(value)) {
      config[key] = value;
      continue;
    }
    warnings.push(
      `[token-speed] ${TOKEN_SPEED_CONFIG_KEY}.${key} must be a hex color like #00ff88; using ${config[key]}.`,
    );
  }

  const rawDisplay = rawSection.display;
  if (rawDisplay != null) {
    if (isTokenSpeedDisplay(rawDisplay)) {
      config.display = rawDisplay;
    } else {
      warnings.push(
        `[token-speed] ${TOKEN_SPEED_CONFIG_KEY}.display must be "tps" or "full"; using ${config.display}.`,
      );
    }
  }

  return { config, warnings };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

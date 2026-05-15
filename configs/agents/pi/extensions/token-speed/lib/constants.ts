import type { TokenSpeedConfig } from "./types";

export const TOKEN_SPEED_CONFIG_KEY = "tokenSpeed";
export const TOKEN_SPEED_STATUS_KEY = "tokenSpeed";

export const TPS_WINDOW_MS = 1_000;
export const TOKEN_TIMESTAMP_COMPACTION_THRESHOLD = 5_000;

export const DEFAULT_TOKEN_SPEED_CONFIG = {
  tpsSlow: 0,
  tpsMedium: 15,
  tpsFast: 30,
  tpsBlazing: 45,
  colorSlow: "#ff4444",
  colorMedium: "#ffaa00",
  colorFast: "#00ff88",
  colorBlazing: "#44ddff",
  display: "tps",
} satisfies TokenSpeedConfig;

import type { TokenSpeedConfig, TokenSpeedDisplay } from "./types";

export function isTokenSpeedDisplay(value: unknown): value is TokenSpeedDisplay {
  return value === "tps" || value === "full";
}

export function isValidHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function hasAscendingThresholds(
  config: Pick<TokenSpeedConfig, "tpsSlow" | "tpsMedium" | "tpsFast" | "tpsBlazing">,
): boolean {
  return config.tpsSlow < config.tpsMedium && config.tpsMedium < config.tpsFast && config.tpsFast < config.tpsBlazing;
}

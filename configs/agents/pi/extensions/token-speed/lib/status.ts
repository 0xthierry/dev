import type { TokenSpeedConfig, TokenSpeedMeasurement, TokenSpeedStatusStyle } from "./types";
import { isValidHexColor } from "./validation";

export const IDLE_TOKEN_SPEED_MEASUREMENT = {
  tps: null,
  tokenCount: 0,
  elapsedSeconds: 0,
} satisfies TokenSpeedMeasurement;

export function formatTokenSpeedStatus(
  config: TokenSpeedConfig,
  measurement: TokenSpeedMeasurement,
  style: TokenSpeedStatusStyle,
): string {
  const measurementText = formatTps(measurement.tps);
  const color = getTokenSpeedColor(config, measurement.tps);
  let text = `${style.dim("⚡ TPS:")} ${colorizeHex(measurementText, color)}`;

  if (config.display === "full") {
    text += ` (${measurement.tokenCount} tok${formatElapsedSuffix(measurement.elapsedSeconds)})`;
  }

  return text;
}

export function getTokenSpeedColor(config: TokenSpeedConfig, tps: number | null): string {
  if (tps == null || !Number.isFinite(tps)) return "";

  if (tps >= config.tpsBlazing) return config.colorBlazing;
  if (tps >= config.tpsFast) return config.colorFast;
  if (tps >= config.tpsMedium) return config.colorMedium;
  if (tps >= config.tpsSlow) return config.colorSlow;

  return "";
}

export function colorizeHex(text: string, hexColor: string): string {
  if (!isValidHexColor(hexColor)) return text;

  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);

  return `\x1b[38;2;${red};${green};${blue}m${text}\x1b[0m`;
}

function formatTps(tps: number | null): string {
  if (tps == null || !Number.isFinite(tps)) return "--";
  return `${Math.max(0, tps).toFixed(1)} tok/s`;
}

function formatElapsedSuffix(elapsedSeconds: number): string {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return "";
  return ` in ${elapsedSeconds.toFixed(1)}s`;
}

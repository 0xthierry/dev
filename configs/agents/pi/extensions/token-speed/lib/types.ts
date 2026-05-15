export type TokenSpeedDisplay = "tps" | "full";

export type TokenSpeedConfig = {
  tpsSlow: number;
  tpsMedium: number;
  tpsFast: number;
  tpsBlazing: number;
  colorSlow: string;
  colorMedium: string;
  colorFast: string;
  colorBlazing: string;
  display: TokenSpeedDisplay;
};

export type TokenSpeedConfigResult = {
  config: TokenSpeedConfig;
  warnings: string[];
};

export type TokenSpeedMeasurement = {
  tps: number | null;
  tokenCount: number;
  elapsedSeconds: number;
};

export type TokenSpeedStatusStyle = {
  dim(text: string): string;
};

import { describe, expect, test } from "bun:test";
import { DEFAULT_TOKEN_SPEED_CONFIG } from "./constants";
import { colorizeHex, formatTokenSpeedStatus, getTokenSpeedColor, IDLE_TOKEN_SPEED_MEASUREMENT } from "./status";
import type { TokenSpeedConfig } from "./types";

describe("formatTokenSpeedStatus", () => {
  test("formats the idle status", () => {
    // Arrange
    const style = { dim: (text: string) => `dim:${text}` };

    // Act
    const result = formatTokenSpeedStatus(DEFAULT_TOKEN_SPEED_CONFIG, IDLE_TOKEN_SPEED_MEASUREMENT, style);

    // Assert
    expect(result).toBe("dim:⚡ TPS: --");
  });

  test("formats full display with elapsed time", () => {
    // Arrange
    const config: TokenSpeedConfig = { ...DEFAULT_TOKEN_SPEED_CONFIG, display: "full" };
    const style = { dim: (text: string) => text };

    // Act
    const result = formatTokenSpeedStatus(config, { tps: 35, tokenCount: 12, elapsedSeconds: 3.25 }, style);

    // Assert
    expect(result).toBe("⚡ TPS: \x1b[38;2;0;255;136m35.0 tok/s\x1b[0m (12 tok in 3.3s)");
  });
});

describe("getTokenSpeedColor", () => {
  test("selects the configured speed tier color", () => {
    // Arrange
    const config = DEFAULT_TOKEN_SPEED_CONFIG;

    // Act
    const colors = [
      getTokenSpeedColor(config, null),
      getTokenSpeedColor(config, 5),
      getTokenSpeedColor(config, 20),
      getTokenSpeedColor(config, 35),
      getTokenSpeedColor(config, 50),
    ];

    // Assert
    expect(colors).toEqual(["", "#ff4444", "#ffaa00", "#00ff88", "#44ddff"]);
  });
});

describe("colorizeHex", () => {
  test("applies ANSI truecolor escapes for valid hex colors", () => {
    // Arrange
    const text = "42.0 tok/s";

    // Act
    const result = colorizeHex(text, "#44ddff");

    // Assert
    expect(result).toBe("\x1b[38;2;68;221;255m42.0 tok/s\x1b[0m");
  });

  test("leaves text unstyled for invalid colors", () => {
    // Arrange
    const text = "42.0 tok/s";

    // Act
    const result = colorizeHex(text, "cyan");

    // Assert
    expect(result).toBe(text);
  });
});

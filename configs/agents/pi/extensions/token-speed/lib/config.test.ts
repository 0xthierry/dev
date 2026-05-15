import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTokenSpeedConfig, resolveTokenSpeedConfig } from "./config";
import { DEFAULT_TOKEN_SPEED_CONFIG } from "./constants";

describe("resolveTokenSpeedConfig", () => {
  test("uses defaults when settings are absent", () => {
    // Arrange
    const settings = undefined;

    // Act
    const result = resolveTokenSpeedConfig(settings);

    // Assert
    expect(result).toEqual({ config: DEFAULT_TOKEN_SPEED_CONFIG, warnings: [] });
  });

  test("merges valid tokenSpeed settings", () => {
    // Arrange
    const settings = {
      tokenSpeed: {
        display: "full",
        tpsSlow: 1,
        tpsMedium: 10,
        tpsFast: 20,
        tpsBlazing: 40,
        colorSlow: "#111111",
        colorMedium: "#222222",
        colorFast: "#333333",
        colorBlazing: "#444444",
      },
    };

    // Act
    const result = resolveTokenSpeedConfig(settings);

    // Assert
    expect(result.warnings).toEqual([]);
    expect(result.config).toEqual({
      display: "full",
      tpsSlow: 1,
      tpsMedium: 10,
      tpsFast: 20,
      tpsBlazing: 40,
      colorSlow: "#111111",
      colorMedium: "#222222",
      colorFast: "#333333",
      colorBlazing: "#444444",
    });
  });

  test("falls back with warnings for invalid values", () => {
    // Arrange
    const settings = {
      tokenSpeed: {
        display: "verbose",
        tpsSlow: 20,
        tpsMedium: 10,
        tpsFast: 30,
        tpsBlazing: 45,
        colorFast: "green",
      },
    };

    // Act
    const result = resolveTokenSpeedConfig(settings);

    // Assert
    expect(result.config).toEqual(DEFAULT_TOKEN_SPEED_CONFIG);
    expect(result.warnings).toContain(
      "[token-speed] TPS thresholds must be ascending; using defaults 0 < 15 < 30 < 45.",
    );
    expect(result.warnings).toContain(
      "[token-speed] tokenSpeed.colorFast must be a hex color like #00ff88; using #00ff88.",
    );
    expect(result.warnings).toContain('[token-speed] tokenSpeed.display must be "tps" or "full"; using tps.');
  });

  test("warns when tokenSpeed is not an object", () => {
    // Arrange
    const settings = { tokenSpeed: true };

    // Act
    const result = resolveTokenSpeedConfig(settings);

    // Assert
    expect(result.config).toEqual(DEFAULT_TOKEN_SPEED_CONFIG);
    expect(result.warnings).toEqual(["[token-speed] tokenSpeed must be an object; using defaults."]);
  });
});

describe("readTokenSpeedConfig", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  test("reads tokenSpeed settings from a settings file", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-token-speed-config-"));
    const settingsPath = join(tempDir, "settings.json");
    await writeFile(settingsPath, JSON.stringify({ tokenSpeed: { display: "full" } }), "utf8");

    // Act
    const result = readTokenSpeedConfig(settingsPath, "settings.json");

    // Assert
    expect(result.config.display).toBe("full");
    expect(result.warnings).toEqual([]);
  });

  test("returns defaults and a warning when the settings file cannot be parsed", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-token-speed-config-"));
    const settingsPath = join(tempDir, "settings.json");
    await writeFile(settingsPath, "{", "utf8");

    // Act
    const result = readTokenSpeedConfig(settingsPath, "settings.json");

    // Assert
    expect(result.config).toEqual(DEFAULT_TOKEN_SPEED_CONFIG);
    expect(result.warnings[0]).toStartWith("[token-speed] Could not read settings.json; using defaults.");
  });
});

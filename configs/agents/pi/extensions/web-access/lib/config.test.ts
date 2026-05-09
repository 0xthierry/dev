import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getConfiguredEnvValue,
  loadConfigFromPath,
  normalizedBoolean,
  normalizedPositiveNumber,
  normalizedString,
} from "./config";

const originalEnvValue = process.env.PI_WEB_ACCESS_CONFIG_TEST_VALUE;
const originalDefaultEnvValue = process.env.PI_WEB_ACCESS_CONFIG_TEST_DEFAULT;

afterEach(() => {
  if (originalEnvValue === undefined) delete process.env.PI_WEB_ACCESS_CONFIG_TEST_VALUE;
  else process.env.PI_WEB_ACCESS_CONFIG_TEST_VALUE = originalEnvValue;

  if (originalDefaultEnvValue === undefined) delete process.env.PI_WEB_ACCESS_CONFIG_TEST_DEFAULT;
  else process.env.PI_WEB_ACCESS_CONFIG_TEST_DEFAULT = originalDefaultEnvValue;
});

describe("config normalization", () => {
  test("normalizes non-empty strings", () => {
    // Arrange / Act / Assert
    expect(normalizedString("  value  ")).toBe("value");
    expect(normalizedString("   ")).toBeUndefined();
    expect(normalizedString(42)).toBeUndefined();
  });

  test("normalizes positive numbers", () => {
    // Arrange / Act / Assert
    expect(normalizedPositiveNumber(12, 5)).toBe(12);
    expect(normalizedPositiveNumber(0, 5)).toBe(5);
    expect(normalizedPositiveNumber(Number.NaN, 5)).toBe(5);
    expect(normalizedPositiveNumber("12", 5)).toBe(5);
  });

  test("normalizes booleans", () => {
    // Arrange / Act / Assert
    expect(normalizedBoolean(true, false)).toBe(true);
    expect(normalizedBoolean(false, true)).toBe(false);
    expect(normalizedBoolean("true", false)).toBe(false);
  });

  test("reads configured env values with default fallback names", () => {
    // Arrange
    process.env.PI_WEB_ACCESS_CONFIG_TEST_VALUE = " configured ";
    process.env.PI_WEB_ACCESS_CONFIG_TEST_DEFAULT = " fallback ";

    // Act
    const configured = getConfiguredEnvValue("PI_WEB_ACCESS_CONFIG_TEST_VALUE", "PI_WEB_ACCESS_CONFIG_TEST_DEFAULT");
    const fallback = getConfiguredEnvValue(" ", "PI_WEB_ACCESS_CONFIG_TEST_DEFAULT");

    // Assert
    expect(configured).toBe("configured");
    expect(fallback).toBe("fallback");
  });

  test("reloads externally edited config files", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "pi-web-config-test-"));
    const configPath = join(dir, "web-search.json");

    try {
      writeFileSync(configPath, JSON.stringify({ medium: { enabled: false } }));
      const initial = loadConfigFromPath(configPath);

      // Act
      writeFileSync(configPath, JSON.stringify({ medium: { enabled: true } }));
      const updated = loadConfigFromPath(configPath);

      // Assert
      expect(initial.medium?.enabled).toBe(false);
      expect(updated.medium?.enabled).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("treats a missing config file as an empty config", () => {
    // Arrange
    const configPath = join(tmpdir(), "pi-web-missing-config.json");

    // Act
    const result = loadConfigFromPath(configPath);

    // Assert
    expect(result).toEqual({});
  });
});

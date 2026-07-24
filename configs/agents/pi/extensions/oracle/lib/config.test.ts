import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ORACLE_BROWSER,
  DEFAULT_ORACLE_MODEL,
  DEFAULT_ORACLE_POLL_INTERVAL_MS,
  DEFAULT_ORACLE_PROFILE,
  DEFAULT_ORACLE_TIMEOUT_MS,
  loadOracleConfigFromPath,
  normalizedPositiveInteger,
  normalizedString,
  normalizeOracleConfig,
} from "./config";

describe("oracle config normalization", () => {
  test("normalizes missing config with ChatGPT defaults", () => {
    // Arrange
    const config = {};

    // Act
    const result = normalizeOracleConfig(config);

    // Assert
    expect(result.chatgpt).toEqual({
      browser: DEFAULT_ORACLE_BROWSER,
      profile: DEFAULT_ORACLE_PROFILE,
      model: DEFAULT_ORACLE_MODEL,
      timeoutMs: DEFAULT_ORACLE_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_ORACLE_POLL_INTERVAL_MS,
    });
  });

  test("normalizes configured ChatGPT browser, profile, model, and timeouts", () => {
    // Arrange
    const config = {
      chatgpt: {
        browser: "brave",
        profile: " Work ",
        model: " gpt-5-6-sol-pro ",
        projectId: " g-p-69ab61612c908191a5a197743a08cb71 ",
        timeoutMs: 12_345.9,
        pollIntervalMs: 250.5,
      },
    };

    // Act
    const result = normalizeOracleConfig(config);

    // Assert
    expect(result.chatgpt).toEqual({
      browser: "Brave",
      profile: "Work",
      model: "gpt-5-6-sol-pro",
      projectId: "g-p-69ab61612c908191a5a197743a08cb71",
      timeoutMs: 12_345,
      pollIntervalMs: 250,
    });
  });

  test("upgrades the previous default model", () => {
    // Arrange
    const config = { chatgpt: { model: "gpt-5-5-pro" } };

    // Act
    const result = normalizeOracleConfig(config);

    // Assert
    expect(result.chatgpt.model).toBe("gpt-5-6-sol-pro");
  });

  test("rejects invalid configured browser and project ids", () => {
    // Arrange
    const invalidBrowser = { chatgpt: { browser: "Safari" } };
    const invalidProject = { chatgpt: { projectId: "project" } };

    // Act
    const normalizeBrowser = () => normalizeOracleConfig(invalidBrowser);
    const normalizeProject = () => normalizeOracleConfig(invalidProject);

    // Assert
    expect(normalizeBrowser).toThrow("Invalid ~/.pi/oracle.json chatgpt.browser value");
    expect(normalizeProject).toThrow("Invalid ~/.pi/oracle.json chatgpt.projectId value");
  });

  test("normalizes strings and positive integers", () => {
    // Arrange
    const values = ["  value  ", "   ", 42] as const;

    // Act
    const strings = values.map((value) => normalizedString(value));
    const numbers = [
      normalizedPositiveInteger(12.9, 5),
      normalizedPositiveInteger(0, 5),
      normalizedPositiveInteger("12", 5),
    ];

    // Assert
    expect(strings).toEqual(["value", undefined, undefined]);
    expect(numbers).toEqual([12, 5, 5]);
  });

  test("loads config from disk and treats a missing file as empty", () => {
    // Arrange
    const dir = mkdtempSync(join(tmpdir(), "pi-oracle-config-test-"));
    const configPath = join(dir, "oracle.json");
    const missingPath = join(dir, "missing.json");

    try {
      writeFileSync(configPath, JSON.stringify({ chatgpt: { browser: "Chrome" } }));

      // Act
      const config = loadOracleConfigFromPath(configPath);
      const missing = loadOracleConfigFromPath(missingPath);

      // Assert
      expect(config.chatgpt?.browser).toBe("Chrome");
      expect(missing).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

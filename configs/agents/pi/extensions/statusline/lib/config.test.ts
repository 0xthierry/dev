import { describe, expect, test } from "bun:test";
import { readStatuslineConfig } from "./config";

describe("readStatuslineConfig", () => {
  test("uses Cloudflare BDR defaults with a BRL display threshold", () => {
    // Arrange
    const env = {};

    // Act
    const result = readStatuslineConfig(env);

    // Assert
    expect(result).toMatchObject({
      refreshMs: 60_000,
      stock: {
        enabled: true,
        symbol: "N2ET34.SA",
        label: "NET",
        ttlMs: 300_000,
        timeoutMs: 2_000,
        maxPrice: 50,
      },
    });
  });

  test("allows disabling the stock segment", () => {
    // Arrange
    const env = { PI_STATUSLINE_STOCK_SYMBOL: "off" };

    // Act
    const result = readStatuslineConfig(env);

    // Assert
    expect(result.stock.enabled).toBe(false);
  });

  test("reads custom refresh and stock settings", () => {
    // Arrange
    const env = {
      PI_STATUSLINE_REFRESH_MS: "10000",
      PI_STATUSLINE_STOCK_SYMBOL: "NET",
      PI_STATUSLINE_STOCK_LABEL: "Cloudflare",
      PI_STATUSLINE_STOCK_TTL_MS: "120000",
      PI_STATUSLINE_STOCK_TIMEOUT_MS: "1500",
      PI_STATUSLINE_STOCK_MAX_PRICE: "80.5",
    };

    // Act
    const result = readStatuslineConfig(env);

    // Assert
    expect(result).toEqual({
      refreshMs: 10_000,
      stock: { enabled: true, symbol: "NET", label: "Cloudflare", ttlMs: 120_000, timeoutMs: 1_500, maxPrice: 80.5 },
    });
  });

  test("allows removing the stock display threshold", () => {
    // Arrange
    const env = { PI_STATUSLINE_STOCK_MAX_PRICE: "off" };

    // Act
    const result = readStatuslineConfig(env);

    // Assert
    expect(result.stock.maxPrice).toBeNull();
  });
});

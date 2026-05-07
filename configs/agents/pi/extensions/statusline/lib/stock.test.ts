import { describe, expect, mock, test } from "bun:test";
import {
  createYahooStockQuoteProvider,
  filterQuoteByMaxPrice,
  parseYahooChartQuote,
  type StockQuoteConfig,
} from "./stock";

const config: StockQuoteConfig = {
  enabled: true,
  symbol: "N2ET34.SA",
  label: "NET",
  ttlMs: 60_000,
  timeoutMs: 1_000,
  maxPrice: 50,
};

describe("parseYahooChartQuote", () => {
  test("extracts price and currency from the Yahoo chart response", () => {
    // Arrange
    const payload = {
      chart: {
        result: [{ meta: { regularMarketPrice: 42.12, currency: "BRL" } }],
      },
    };

    // Act
    const result = parseYahooChartQuote(payload, "N2ET34.SA", "NET");

    // Assert
    expect(result).toEqual({ symbol: "N2ET34.SA", label: "NET", price: 42.12, currency: "BRL" });
  });

  test("returns null when the price is missing", () => {
    // Arrange
    const payload = { chart: { result: [{ meta: {} }] } };

    // Act
    const result = parseYahooChartQuote(payload, "N2ET34.SA", "NET");

    // Assert
    expect(result).toBeNull();
  });
});

describe("filterQuoteByMaxPrice", () => {
  test("keeps quotes below the display threshold", () => {
    // Arrange
    const quote = { symbol: "N2ET34.SA", label: "NET", price: 49.99, currency: "BRL" };

    // Act
    const result = filterQuoteByMaxPrice(quote, 50);

    // Assert
    expect(result).toBe(quote);
  });

  test("hides quotes at or above the display threshold", () => {
    // Arrange
    const quote = { symbol: "N2ET34.SA", label: "NET", price: 50, currency: "BRL" };

    // Act
    const result = filterQuoteByMaxPrice(quote, 50);

    // Assert
    expect(result).toBeNull();
  });
});

describe("createYahooStockQuoteProvider", () => {
  test("fetches and caches stock quotes below the threshold", async () => {
    // Arrange
    let now = 1_000;
    const fetchImpl = mock(async () =>
      Response.json({ chart: { result: [{ meta: { regularMarketPrice: 49.5, currency: "BRL" } }] } }),
    );
    const provider = createYahooStockQuoteProvider(config, fetchImpl, () => now);

    // Act
    const first = await provider.getQuote();
    now += 10_000;
    const second = await provider.getQuote();

    // Assert
    expect(first).toEqual({ symbol: "N2ET34.SA", label: "NET", price: 49.5, currency: "BRL" });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("hides stock quotes above the threshold", async () => {
    // Arrange
    const fetchImpl = mock(async () =>
      Response.json({ chart: { result: [{ meta: { regularMarketPrice: 50.01, currency: "BRL" } }] } }),
    );
    const provider = createYahooStockQuoteProvider(config, fetchImpl);

    // Act
    const result = await provider.getQuote();

    // Assert
    expect(result).toBeNull();
  });

  test("returns null without fetching when disabled", async () => {
    // Arrange
    const fetchImpl = mock(async () => Response.json({}));
    const provider = createYahooStockQuoteProvider({ ...config, enabled: false }, fetchImpl);

    // Act
    const result = await provider.getQuote();

    // Assert
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

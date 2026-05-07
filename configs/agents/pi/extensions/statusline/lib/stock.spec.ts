import { describe, expect, test } from "bun:test";
import { createYahooStockQuoteProvider, type StockQuoteConfig } from "./stock";

const liveCloudflareConfig: StockQuoteConfig = {
  enabled: true,
  symbol: "N2ET34.SA",
  label: "NET",
  ttlMs: 60_000,
  timeoutMs: 5_000,
  maxPrice: null,
};

describe("Cloudflare BDR stock quote live contract", () => {
  test("fetches a positive N2ET34.SA quote from Yahoo Finance", async () => {
    // Arrange
    const provider = createYahooStockQuoteProvider(liveCloudflareConfig);

    // Act
    const quote = await provider.getQuote();

    // Assert
    expect(quote).not.toBeNull();
    expect(quote?.symbol).toBe("N2ET34.SA");
    expect(quote?.label).toBe("NET");
    expect(quote?.price).toBeGreaterThan(0);
  }, 15_000);
});

import type { StockQuote, StockQuoteProvider } from "./types";

export type StockQuoteConfig = {
  enabled: boolean;
  symbol: string;
  label: string;
  ttlMs: number;
  timeoutMs: number;
  maxPrice: number | null;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type CachedQuote = {
  fetchedAt: number;
  quote: StockQuote | null;
};

const YAHOO_CHART_ENDPOINT = "https://query1.finance.yahoo.com/v8/finance/chart";

export function createYahooStockQuoteProvider(
  config: StockQuoteConfig,
  fetchImpl: FetchLike = globalThis.fetch,
): StockQuoteProvider {
  let cached: CachedQuote | undefined;

  return {
    async getQuote(signal?: AbortSignal): Promise<StockQuote | null> {
      if (!config.enabled) return null;

      const currentTime = Date.now();
      if (cached && currentTime - cached.fetchedAt < config.ttlMs) return cached.quote;

      try {
        const response = await fetchImpl(`${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(config.symbol)}`, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: createTimeoutSignal(config.timeoutMs, signal),
        });
        if (!response.ok) return cached?.quote ?? null;

        const payload = await response.json();
        const quote = filterQuoteByMaxPrice(
          parseYahooChartQuote(payload, config.symbol, config.label),
          config.maxPrice,
        );
        cached = { fetchedAt: currentTime, quote };
        return quote;
      } catch {
        return cached?.quote ?? null;
      }
    },
  };
}

export function parseYahooChartQuote(payload: unknown, symbol: string, label: string): StockQuote | null {
  const meta = readYahooMeta(payload);
  const rawPrice = meta?.regularMarketPrice;
  const price = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  const currency = typeof meta?.currency === "string" && meta.currency.trim() ? meta.currency.trim() : undefined;
  return { symbol, label, price, currency };
}

export function filterQuoteByMaxPrice(quote: StockQuote | null, maxPrice: number | null): StockQuote | null {
  if (!quote) return null;
  if (maxPrice == null) return quote;
  return quote.price < maxPrice ? quote : null;
}

function createTimeoutSignal(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  if (parent?.aborted) {
    clearTimeout(timeout);
    controller.abort(parent.reason);
    return controller.signal;
  }

  parent?.addEventListener(
    "abort",
    () => {
      clearTimeout(timeout);
      controller.abort(parent.reason);
    },
    { once: true },
  );

  return controller.signal;
}

function readYahooMeta(payload: unknown): Record<string, unknown> | null {
  const root = asRecord(payload);
  const chart = asRecord(root?.chart);
  const result = Array.isArray(chart?.result) ? chart.result[0] : undefined;
  const firstResult = asRecord(result);
  return asRecord(firstResult?.meta);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

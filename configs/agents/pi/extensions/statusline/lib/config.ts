import type { StockQuoteConfig } from "./stock";

export type StatuslineConfig = {
  refreshMs: number;
  stock: StockQuoteConfig;
};

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_STOCK_TTL_MS = 5 * 60_000;
const DEFAULT_STOCK_TIMEOUT_MS = 2_000;
const DEFAULT_STOCK_SYMBOL = "N2ET34.SA";
const DEFAULT_STOCK_LABEL = "NET";
const DEFAULT_STOCK_MAX_PRICE: number | null = null;

export function readStatuslineConfig(env: NodeJS.ProcessEnv = process.env): StatuslineConfig {
  const stockSymbol = env.PI_STATUSLINE_STOCK_SYMBOL;
  const stockEnabled = isStockEnabled(stockSymbol);
  const symbol = stockEnabled ? normalizeStockSymbol(stockSymbol) : "";

  return {
    refreshMs: parsePositiveInteger(env.PI_STATUSLINE_REFRESH_MS, DEFAULT_REFRESH_MS),
    stock: {
      enabled: stockEnabled,
      symbol,
      label: normalizeStockLabel(env.PI_STATUSLINE_STOCK_LABEL, symbol),
      ttlMs: parsePositiveInteger(env.PI_STATUSLINE_STOCK_TTL_MS, DEFAULT_STOCK_TTL_MS),
      timeoutMs: parsePositiveInteger(env.PI_STATUSLINE_STOCK_TIMEOUT_MS, DEFAULT_STOCK_TIMEOUT_MS),
      maxPrice: parseOptionalPositiveNumber(env.PI_STATUSLINE_STOCK_MAX_PRICE, DEFAULT_STOCK_MAX_PRICE),
    },
  };
}

function isStockEnabled(rawSymbol: string | undefined): boolean {
  if (rawSymbol == null) return true;
  const normalized = rawSymbol.trim().toLowerCase();
  return (
    normalized !== "" && normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "none"
  );
}

function normalizeStockSymbol(rawSymbol: string | undefined): string {
  return rawSymbol?.trim() || DEFAULT_STOCK_SYMBOL;
}

function normalizeStockLabel(rawLabel: string | undefined, symbol: string): string {
  return rawLabel?.trim() || (symbol === DEFAULT_STOCK_SYMBOL ? DEFAULT_STOCK_LABEL : symbol);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalPositiveNumber(value: string | undefined, fallback: number | null): number | null {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "off" || normalized === "none" || normalized === "false" || normalized === "0") return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

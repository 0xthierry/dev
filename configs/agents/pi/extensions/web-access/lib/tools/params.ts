export function normalizeQueryList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

export function normalizeRecencyFilter(value: unknown): "day" | "week" | "month" | "year" | undefined {
  return value === "day" || value === "week" || value === "month" || value === "year" ? value : undefined;
}

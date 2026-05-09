import { createHash } from "node:crypto";
import type { StoredSearchData } from "../types";

const storedResults = new Map<string, StoredSearchData>();
let fallbackId = 0;

export function generateId(prefix = "result", seed?: unknown): string {
  if (seed === undefined) {
    fallbackId += 1;
    return `${prefix}-${fallbackId}`;
  }

  const digest = createHash("sha256").update(stableStringify(seed)).digest("hex").slice(0, 12);
  return `${prefix}-${digest}`;
}

export function storeResult(id: string, data: StoredSearchData): void {
  storedResults.set(id, data);
}

export function getResult(id: string): StoredSearchData | null {
  return storedResults.get(id) ?? null;
}

export function getAllResults(): StoredSearchData[] {
  return Array.from(storedResults.values());
}

export function deleteResult(id: string): boolean {
  return storedResults.delete(id);
}

export function clearResults(): void {
  storedResults.clear();
  fallbackId = 0;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForHash(value));
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeForHash(item) ?? null);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const nextValue = normalizeForHash((value as Record<string, unknown>)[key]);
    if (nextValue !== undefined) normalized[key] = nextValue;
  }
  return normalized;
}

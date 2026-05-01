import type { StoredSearchData } from "../types";

const storedResults = new Map<string, StoredSearchData>();

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
}

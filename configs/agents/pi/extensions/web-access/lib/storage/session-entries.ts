import { isWebAccessError } from "../shared/errors";
import type { ExtractedContent, QueryResultData, StoredSearchData } from "../types";
import { clearResults, storeResult } from "./result-store";

const CACHE_TTL_MS = 60 * 60 * 1000;

export type SessionEntryLike = {
  type?: unknown;
  customType?: unknown;
  data?: unknown;
};

function isQueryResultData(value: unknown): value is QueryResultData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.query !== "string") return false;
  if (typeof record.answer !== "string") return false;
  if (!Array.isArray(record.results)) return false;
  if (record.error === null) return true;
  return typeof record.error === "string" && isWebAccessError(record.errorDetails);
}

function isExtractedContent(value: unknown): value is ExtractedContent {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== "string") return false;
  if (typeof record.title !== "string") return false;
  if (typeof record.content !== "string") return false;
  if (record.error === null) return true;
  return typeof record.error === "string" && isWebAccessError(record.errorDetails);
}

function isValidStoredData(data: unknown): data is StoredSearchData {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id) return false;
  if (value.type !== "search" && value.type !== "fetch") return false;
  if (typeof value.timestamp !== "number") return false;
  if (value.type === "search") return Array.isArray(value.queries) && value.queries.every(isQueryResultData);
  return Array.isArray(value.urls) && value.urls.every(isExtractedContent);
}

export function restoreFromEntries(entries: Iterable<SessionEntryLike>, now = Date.now()): void {
  clearResults();

  for (const entry of entries) {
    if (entry.type === "custom" && entry.customType === "web-access-results") {
      const data = entry.data;
      if (isValidStoredData(data) && now - data.timestamp < CACHE_TTL_MS) {
        storeResult(data.id, data);
      }
    }
  }
}

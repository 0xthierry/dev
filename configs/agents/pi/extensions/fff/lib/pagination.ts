import type { GrepCursor } from "./types";

const MAX_CURSOR_CACHE_SIZE = 200;

export type FindCursor = {
  query: string;
  pattern: string;
  pageSize: number;
  nextPageIndex: number;
};

export type CursorStore = {
  storeGrep(cursor: GrepCursor): string;
  getGrep(id: string): GrepCursor | undefined;
  storeFind(cursor: FindCursor): string;
  getFind(id: string): FindCursor | undefined;
};

export function createCursorStore(maxSize = MAX_CURSOR_CACHE_SIZE): CursorStore {
  const grepCursors = new Map<string, GrepCursor>();
  const findCursors = new Map<string, FindCursor>();
  let grepCounter = 0;
  let findCounter = 0;

  return {
    storeGrep(cursor) {
      const id = `fff_g${++grepCounter}`;
      grepCursors.set(id, cursor);
      evictOldest(grepCursors, maxSize);
      return id;
    },

    getGrep(id) {
      return grepCursors.get(id);
    },

    storeFind(cursor) {
      const id = `fff_f${++findCounter}`;
      findCursors.set(id, cursor);
      evictOldest(findCursors, maxSize);
      return id;
    },

    getFind(id) {
      return findCursors.get(id);
    },
  };
}

function evictOldest<TKey, TValue>(map: Map<TKey, TValue>, maxSize: number): void {
  while (map.size > maxSize) {
    const first = map.keys().next().value;
    if (first === undefined) return;
    map.delete(first);
  }
}

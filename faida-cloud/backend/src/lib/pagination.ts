// Shared keyset (cursor) pagination helpers. DOC 02 §3 forbids offset
// pagination — it silently skips/repeats rows under concurrent inserts,
// which is exactly what happens on a POS feed. Every list endpoint pages
// on an opaque cursor encoding (sortValue, id) and a whitelisted sort key,
// per Phase 4's Task 3 spec.

export interface Cursor {
  sortValue: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Cursor).sortValue === "string" &&
      typeof (parsed as Cursor).id === "string"
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.trunc(n), MAX_PAGE_SIZE);
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Given a page fetched with `limit + 1` rows (the overfetch-by-one
// convention used everywhere in this file's callers) and a function to
// pull the (sortValue, id) pair the cursor is keyed on out of a row,
// slices to the requested page size and encodes the next cursor.
export function buildPage<T>(rows: T[], limit: number, keyOf: (row: T) => Cursor): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(keyOf(last)) : null;
  return { data, nextCursor, hasMore };
}

// The trading day is bounded in the vendor's local time, not UTC (Phase 4's
// governing principle). Every Faida vendor is in Tanzania, and Africa/
// Dar_es_Salaam is a fixed UTC+3 offset year-round — Tanzania has never
// observed DST — so a full IANA timezone library is unneeded complexity;
// a hardcoded offset is exact, not an approximation.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// [start, end) in UTC for the given vendor-local calendar date.
export function vendorDayBoundsUtc(date: string): { start: Date; end: Date } {
  if (!DATE_RE.test(date)) throw new Error(`date must be YYYY-MM-DD, got "${date}"`);
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - EAT_OFFSET_MS;
  return { start: new Date(startUtcMs), end: new Date(startUtcMs + 24 * 60 * 60 * 1000) };
}

// The vendor-local calendar date (YYYY-MM-DD) a UTC instant falls in —
// used to file a synced record under the right summary_date regardless of
// when it actually reached the server.
export function vendorLocalDate(utc: Date): string {
  const eat = new Date(utc.getTime() + EAT_OFFSET_MS);
  const y = eat.getUTCFullYear();
  const m = String(eat.getUTCMonth() + 1).padStart(2, "0");
  const d = String(eat.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

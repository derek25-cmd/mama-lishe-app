import { describe, it, expect } from "vitest";
import { recordSale } from "@/lib/pos";
import { createTestVendor, authedGet } from "./helpers";
import { GET } from "@/app/api/v1/sales/route";

const PAGE_SIZE = 20;
const ORIGINAL_COUNT = 300;
const CONCURRENT_INSERT_COUNT = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SaleListItem {
  id: string;
  client_id: string;
}
interface SalesPage {
  data: SaleListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Keyset pagination's entire reason for existing over offset pagination:
// concurrent inserts must never cause a page walk to skip or repeat a row
// that was already there before the walk started. This seeds 300 sales,
// then pages through all of them via the real GET /sales route handler
// while a second stream inserts 40 more sales in the background — the
// walk must still see each of the original 300 exactly once.
describe("cursor pagination stability under concurrent inserts", () => {
  it("visits every pre-existing sale exactly once while new sales are being inserted concurrently", async () => {
    const { ctx, accessToken } = await createTestVendor();

    const originalClientIds = new Set<string>();
    for (let i = 0; i < ORIGINAL_COUNT; i++) {
      const clientId = `orig-${i}`;
      originalClientIds.add(clientId);
      await recordSale(ctx, {
        clientId,
        soldAt: new Date(Date.UTC(2026, 6, 1, 6, 0, 0) + i * 1000),
        quantity: 1,
        unitPriceTzs: 1000,
        totalTzs: 1000,
        paymentMethod: "cash",
      });
    }

    const inserter = (async () => {
      for (let i = 0; i < CONCURRENT_INSERT_COUNT; i++) {
        await sleep(5);
        await recordSale(ctx, {
          clientId: `concurrent-${i}`,
          soldAt: new Date(Date.UTC(2026, 6, 1, 6, 0, 0) + (ORIGINAL_COUNT + i) * 1000),
          quantity: 1,
          unitPriceTzs: 500,
          totalTzs: 500,
          paymentMethod: "cash",
        });
      }
    })();

    const seenClientIds: string[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL(`http://test/api/v1/sales?limit=${PAGE_SIZE}&sort=sold_at&order=asc`);
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await GET(authedGet(url.toString(), accessToken));
      expect(res.status).toBe(200);
      const page = (await res.json()) as SalesPage;
      for (const row of page.data) seenClientIds.push(row.client_id);
      cursor = page.nextCursor;
      await sleep(3); // give the concurrent inserter a chance to interleave
    } while (cursor);

    await inserter;

    const seenOriginal = seenClientIds.filter((id) => originalClientIds.has(id));
    const counts = new Map<string, number>();
    for (const id of seenOriginal) counts.set(id, (counts.get(id) ?? 0) + 1);

    expect(seenOriginal).toHaveLength(ORIGINAL_COUNT);
    expect([...counts.values()].every((c) => c === 1)).toBe(true);
  }, 60_000);
});

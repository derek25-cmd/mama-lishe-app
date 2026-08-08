import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { applySyncBatch, type SyncRecord } from "@/lib/pos";
import { getPool } from "@/lib/db";
import { createTestVendor } from "./helpers";

// This measures round-trip latency against the Testcontainers Postgres
// instance this whole suite runs against — useful as a regression signal
// (this test would start failing if a change made record application
// dramatically slower), but it is NOT the same measurement the Phase 4
// brief's "≤ 15s against the deployed server" refers to. That's a live
// network+production-Postgres measurement, covered by Task 7's scripted
// verification transcript against the actual deployed stack, not
// something a local container can honestly stand in for.
describe("scale — 3-day offline vendor, 200 records", () => {
  it("applies a 200-record batch spanning 3 distinct trading days and produces correct summaries for all three", async () => {
    const { ctx, vendorId } = await createTestVendor();
    const dates = ["2026-08-01", "2026-08-02", "2026-08-03"];
    const records: SyncRecord[] = [];
    const expectedRevenueByDate = new Map<string, number>();

    // ~65 sales/day x 3 days + a day_close per day ≈ 200 records.
    for (const date of dates) {
      let revenue = 0;
      for (let i = 0; i < 65; i++) {
        const totalTzs = 1000 * (1 + (i % 5));
        revenue += totalTzs;
        records.push({
          type: "sale",
          clientId: ulid(),
          clientCreatedAt: `${date}T10:00:00Z`,
          payload: {
            soldAt: `${date}T${String(6 + (i % 14)).padStart(2, "0")}:00:00Z`,
            quantity: 1,
            unitPriceTzs: totalTzs,
            totalTzs,
            paymentMethod: "cash",
          },
        });
      }
      expectedRevenueByDate.set(date, revenue);
      records.push({
        type: "day_close",
        clientId: ulid(),
        clientCreatedAt: `${date}T21:00:00Z`,
        payload: { date, wastePlates: 0 },
      });
    }

    expect(records.length).toBeGreaterThanOrEqual(195);
    expect(records.length).toBeLessThanOrEqual(205);

    const startedAt = Date.now();
    const results = await applySyncBatch(ctx, records);
    const elapsedMs = Date.now() - startedAt;

    expect(results.every((r) => r.status === "applied")).toBe(true);
    expect(elapsedMs).toBeLessThanOrEqual(15_000);

    for (const date of dates) {
      const dayClose = results.find((r) => records.find((rec) => rec.clientId === r.clientId && rec.type === "day_close" && (rec.payload as { date: string }).date === date));
      expect(dayClose?.status).toBe("applied");

      const summary = await getPool().query<{ revenue_tzs: number }>(
        `select revenue_tzs from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
        [vendorId, date],
      );
      expect(summary.rows[0]!.revenue_tzs).toBe(expectedRevenueByDate.get(date));
    }
  }, 30_000);
});

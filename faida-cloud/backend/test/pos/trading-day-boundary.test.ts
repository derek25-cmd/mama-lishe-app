import { describe, it, expect } from "vitest";
import { recordSale, recomputeDailySummary } from "@/lib/pos";
import { createTestVendor } from "./helpers";

// Africa/Dar_es_Salaam is a fixed UTC+3 offset. 23:30 EAT on 2026-06-15 is
// 20:30 UTC the same calendar day; 00:30 EAT on 2026-06-16 is 21:30 UTC —
// only an hour later in UTC, but across the vendor-local midnight, so it
// must file under the NEXT day's summary, not the one 20:30 UTC belongs to.
describe("trading-day boundary — Africa/Dar_es_Salaam, not UTC", () => {
  it("a sale at 23:30 EAT and one at 00:30 EAT land in different summary dates", async () => {
    const { ctx } = await createTestVendor();

    await recordSale(ctx, {
      clientId: "boundary-late",
      soldAt: new Date("2026-06-15T20:30:00Z"), // 23:30 EAT, 2026-06-15
      quantity: 1,
      unitPriceTzs: 4000,
      totalTzs: 4000,
      paymentMethod: "cash",
    });
    await recordSale(ctx, {
      clientId: "boundary-early",
      soldAt: new Date("2026-06-15T21:30:00Z"), // 00:30 EAT, 2026-06-16
      quantity: 1,
      unitPriceTzs: 6000,
      totalTzs: 6000,
      paymentMethod: "cash",
    });

    const day15 = await recomputeDailySummary(ctx, "2026-06-15");
    const day16 = await recomputeDailySummary(ctx, "2026-06-16");

    expect(day15.revenue_tzs).toBe(4000);
    expect(day16.revenue_tzs).toBe(6000);
  });

  it("a sale at exactly UTC midnight is still 03:00 EAT — same vendor-local day it looks like in UTC", async () => {
    const { ctx } = await createTestVendor();
    await recordSale(ctx, {
      clientId: "boundary-utc-midnight",
      soldAt: new Date("2026-06-20T00:00:00Z"), // 03:00 EAT, 2026-06-20
      quantity: 1,
      unitPriceTzs: 1000,
      totalTzs: 1000,
      paymentMethod: "cash",
    });
    const summary = await recomputeDailySummary(ctx, "2026-06-20");
    expect(summary.revenue_tzs).toBe(1000);
  });
});

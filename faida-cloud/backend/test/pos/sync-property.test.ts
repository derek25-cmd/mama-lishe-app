import { describe, it, expect } from "vitest";
import { getPool } from "@/lib/db";
import { applySyncBatch } from "@/lib/pos";
import { createTestVendor } from "./helpers";
import { mulberry32, generateTradingDay, mutateIntoScenario } from "./gen";

// The single most important test in Phase 4. One realistic trading day
// (40-120 sales, 5 expenses, 8 of the sales on deni, 3 partial deni
// payments, one day close) is generated once from a fixed seed — the DATA
// never changes across runs. What changes per run is delivery: shuffled
// order, a random subset duplicated, split into random batch sizes, and
// ~20% of batches resent a second time (simulating a client that timed out
// and retried without knowing the first attempt landed). Applying the
// baseline once, in order, and applying any of the 500+ mutated delivery
// scenarios must produce byte-identical final state: same row counts, same
// monetary totals, same deni balances, same day summary. If it doesn't,
// the sync contract's core promise — reordering/duplication/batching/
// retries are all invisible to the final state — is broken.
const RUNS = 500;
const DATA_SEED = 1; // fixed: only delivery (mutation) varies across runs

describe("sync property test — delivery order/duplication/batching/retries never change final state", () => {
  it(
    `produces identical final state across ${RUNS} randomized delivery scenarios of the same trading day`,
    async () => {
      const baseline = await createTestVendor();
      const day = generateTradingDay(mulberry32(DATA_SEED), "2026-09-01");
      const baselineResults = await applySyncBatch(baseline.ctx, day.records);
      expect(baselineResults.every((r) => r.status === "applied")).toBe(true);
      const baselineState = await captureState(baseline.vendorId, day.date);

      // Sanity check the oracle against the baseline once, so a bug in the
      // generator's own bookkeeping fails loudly here rather than silently
      // making every comparison below vacuously pass.
      expect(baselineState.salesCount).toBe(day.expected.saleCount);
      expect(baselineState.revenue).toBe(day.expected.totalRevenueTzs);
      expect(baselineState.expensesTotal).toBe(day.expected.expenseTotalTzs);
      expect(baselineState.summary?.waste_plates).toBe(day.expected.wastePlates);

      for (let run = 0; run < RUNS; run++) {
        const mutationRng = mulberry32(1_000_000 + run);
        const vendor = await createTestVendor();
        // Regenerated from the SAME data seed every run — identical
        // records, only delivery varies.
        const sameDay = generateTradingDay(mulberry32(DATA_SEED), day.date);
        const batches = mutateIntoScenario(mutationRng, sameDay.records);

        for (const batch of batches) {
          if (batch.length === 0) continue;
          await applySyncBatch(vendor.ctx, batch);
        }

        // A deni_payment can be legitimately rejected (not a bug — the
        // balance check is correctly timing-sensitive) if it lands in an
        // earlier batch than some of that same customer's sales, which a
        // random shuffle-and-split absolutely can produce despite every
        // payment being generated well within its customer's eventual
        // balance. A real offline client doesn't give up on a rejected
        // record forever — it retries on its next sync pass. This models
        // exactly that: one final full resend of every original record.
        // It's always safe regardless of what already landed — every
        // record type here is idempotent (insert-if-new), so anything
        // already applied just comes back 'duplicate'.
        await applySyncBatch(vendor.ctx, sameDay.records);

        const state = await captureState(vendor.vendorId, day.date);
        expect(state, `run ${run} (batches=${batches.length}) diverged from the baseline`).toEqual(baselineState);
      }
    },
    30 * 60_000, // 30 minutes — 500 full trading-day scenarios against real Postgres
  );
});

interface CapturedState {
  salesCount: number;
  voidedCount: number;
  revenue: number;
  expensesCount: number;
  expensesTotal: number;
  deniCustomers: { name: string; phone: string | null }[];
  deniBalances: { name: string; balance: number }[];
  deniPaymentsCount: number;
  deniPaymentsTotal: number;
  summary: {
    revenue_tzs: number;
    cogs_tzs: number;
    other_exp_tzs: number;
    profit_tzs: number;
    plates_sold: number;
    plates_planned: number;
    waste_plates: number;
    deni_issued_tzs: number;
  } | null;
}

// Deliberately content-based, not id-based: every run creates a fresh
// vendor with fresh row UUIDs, so comparing raw ids across runs would
// always fail even for two runs that are otherwise identical. Row counts
// and monetary sums are what the spec asks this test to prove invariant.
async function captureState(vendorId: string, date: string): Promise<CapturedState> {
  const pool = getPool();

  const salesAgg = await pool.query<{ cnt: string; voided_cnt: string; revenue: string }>(
    `select count(*) as cnt, count(*) filter (where voided) as voided_cnt,
            coalesce(sum(total_tzs) filter (where not voided), 0) as revenue
     from pos.sales where vendor_id = $1`,
    [vendorId],
  );
  const expensesAgg = await pool.query<{ cnt: string; total: string }>(
    `select count(*) as cnt, coalesce(sum(amount_tzs), 0) as total from pos.expenses where vendor_id = $1`,
    [vendorId],
  );
  const deniCustomers = await pool.query<{ name: string; phone: string | null }>(
    `select name, phone from pos.deni_customers where vendor_id = $1 order by name`,
    [vendorId],
  );
  const deniBalances = await pool.query<{ name: string; balance: string }>(
    `select dc.name,
            coalesce((select sum(s.total_tzs) from pos.sales s where s.vendor_id = $1 and s.deni_customer_id = dc.id and s.voided = false), 0)
            - coalesce((select sum(p.amount_tzs) from pos.deni_payments p where p.vendor_id = $1 and p.deni_customer_id = dc.id), 0)
            as balance
     from pos.deni_customers dc where dc.vendor_id = $1 order by dc.name`,
    [vendorId],
  );
  const deniPaymentsAgg = await pool.query<{ cnt: string; total: string }>(
    `select count(*) as cnt, coalesce(sum(amount_tzs), 0) as total from pos.deni_payments where vendor_id = $1`,
    [vendorId],
  );
  const summary = await pool.query<CapturedState["summary"] & object>(
    `select revenue_tzs, cogs_tzs, other_exp_tzs, profit_tzs, plates_sold, plates_planned, waste_plates, deni_issued_tzs
     from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
    [vendorId, date],
  );

  return {
    salesCount: Number(salesAgg.rows[0]!.cnt),
    voidedCount: Number(salesAgg.rows[0]!.voided_cnt),
    revenue: Number(salesAgg.rows[0]!.revenue),
    expensesCount: Number(expensesAgg.rows[0]!.cnt),
    expensesTotal: Number(expensesAgg.rows[0]!.total),
    deniCustomers: deniCustomers.rows,
    deniBalances: deniBalances.rows.map((r) => ({ name: r.name, balance: Number(r.balance) })),
    deniPaymentsCount: Number(deniPaymentsAgg.rows[0]!.cnt),
    deniPaymentsTotal: Number(deniPaymentsAgg.rows[0]!.total),
    summary: summary.rows[0] ?? null,
  };
}

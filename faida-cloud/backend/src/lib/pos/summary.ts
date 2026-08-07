import type { PoolClient } from "pg";
import { withVendorContext, type VendorContext } from "@/lib/db";
import { vendorDayBoundsUtc } from "@/lib/pos/timezone";
import type { DailySummaryRow } from "@/lib/pos/types";

const SUMMARY_COLUMNS = `vendor_id, summary_date::text, revenue_tzs, cogs_tzs, other_exp_tzs, profit_tzs,
   plates_sold, plates_planned, waste_plates, deni_issued_tzs, closed_at, recomputed_at, notes`;

// Derives pos.daily_summaries entirely from the ledgers (sales, expenses,
// the day's cook plan) for one vendor-local day and writes it
// transactionally. This is the single source of truth both Task 3's
// close-day route and Task 5's nightly reconciliation job call — the
// summary table itself has no independent state of its own except
// waste_plates and notes (vendor-reported, not derivable from any ledger)
// and closed_at (set only by closeDay below), which this function
// preserves unless explicitly overridden.
//
// COGS = every malighafi expense logged that vendor-local day, plus that
// day's cook plan's actual_cost_tzs if shopping was confirmed through the
// Plans API (Phase 3). Deliberately NOT scoped to only malighafi expenses
// whose plan_id links to that day's plan: an early version of this
// function did that (reading the brief's "linked to that day's plan"
// literally), and a live smoke test caught the resulting bug immediately —
// a malighafi expense recorded without a plan_id (duka mode, or a vendor
// who doesn't use the Plans API at all) fell into neither cogs_tzs nor
// other_exp_tzs and vanished from the summary entirely, silently
// overstating profit by the full expense amount. That is a far worse
// failure than the double-count risk this version accepts instead (a
// vendor who both confirms plan shopping AND separately logs the same
// purchase as an expense) — real money a vendor spent must never be
// invisible to her profit figure. plan_id remains on pos.expenses for
// traceability (Task 3's expense detail view), just not as a gate here.
export async function recomputeDailySummary(
  ctx: VendorContext,
  date: string,
  wastePlatesOverride?: number,
  notesOverride?: string | null,
): Promise<DailySummaryRow> {
  return withVendorContext(ctx, (client) =>
    recomputeDailySummaryInTx(client, ctx.vendorId, date, wastePlatesOverride, notesOverride),
  );
}

export async function recomputeDailySummaryInTx(
  client: PoolClient,
  vendorId: string,
  date: string,
  wastePlatesOverride?: number,
  notesOverride?: string | null,
): Promise<DailySummaryRow> {
  const { start, end } = vendorDayBoundsUtc(date);

  const salesAgg = await client.query<{ revenue_tzs: string; deni_issued_tzs: string; plates_sold: string }>(
    `select
       coalesce(sum(total_tzs) filter (where not voided), 0) as revenue_tzs,
       coalesce(sum(total_tzs) filter (where not voided and payment_method = 'deni'), 0) as deni_issued_tzs,
       coalesce(sum(quantity) filter (where not voided and recipe_id is not null), 0) as plates_sold
     from pos.sales
     where vendor_id = $1 and sold_at >= $2 and sold_at < $3`,
    [vendorId, start, end],
  );

  const plans = await client.query<{ id: string; actual_cost_tzs: number | null }>(
    `select id, actual_cost_tzs from costing.cook_plans where vendor_id = $1 and plan_date = $2`,
    [vendorId, date],
  );
  const planIds = plans.rows.map((r) => r.id);
  const planActualCostTzs = plans.rows.reduce((sum, r) => sum + (r.actual_cost_tzs ?? 0), 0);

  const platesPlanned = await client.query<{ plates_planned: string }>(
    `select coalesce(sum(plates), 0) as plates_planned
     from costing.cook_plan_items where plan_id = any($1::uuid[])`,
    [planIds],
  );

  const malighafi = await client.query<{ total: string }>(
    `select coalesce(sum(amount_tzs), 0) as total
     from pos.expenses
     where vendor_id = $1 and category = 'malighafi' and spent_at >= $2 and spent_at < $3`,
    [vendorId, start, end],
  );

  const otherExp = await client.query<{ total: string }>(
    `select coalesce(sum(amount_tzs), 0) as total
     from pos.expenses
     where vendor_id = $1 and category <> 'malighafi' and spent_at >= $2 and spent_at < $3`,
    [vendorId, start, end],
  );

  const revenueTzs = Number(salesAgg.rows[0]!.revenue_tzs);
  const deniIssuedTzs = Number(salesAgg.rows[0]!.deni_issued_tzs);
  const platesSold = Number(salesAgg.rows[0]!.plates_sold);
  const platesPlannedCount = Number(platesPlanned.rows[0]!.plates_planned);
  const cogsTzs = Number(malighafi.rows[0]!.total) + planActualCostTzs;
  const otherExpTzs = Number(otherExp.rows[0]!.total);
  const profitTzs = revenueTzs - cogsTzs - otherExpTzs;

  const existing = await client.query<DailySummaryRow>(
    `select ${SUMMARY_COLUMNS} from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
    [vendorId, date],
  );
  const wastePlates = wastePlatesOverride ?? existing.rows[0]?.waste_plates ?? 0;
  const notes = notesOverride !== undefined ? notesOverride : (existing.rows[0]?.notes ?? null);

  const upserted = await client.query<DailySummaryRow>(
    `insert into pos.daily_summaries
       (vendor_id, summary_date, revenue_tzs, cogs_tzs, other_exp_tzs, profit_tzs,
        plates_sold, plates_planned, waste_plates, deni_issued_tzs, recomputed_at, notes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11)
     on conflict (vendor_id, summary_date) do update set
       revenue_tzs = excluded.revenue_tzs,
       cogs_tzs = excluded.cogs_tzs,
       other_exp_tzs = excluded.other_exp_tzs,
       profit_tzs = excluded.profit_tzs,
       plates_sold = excluded.plates_sold,
       plates_planned = excluded.plates_planned,
       waste_plates = excluded.waste_plates,
       deni_issued_tzs = excluded.deni_issued_tzs,
       recomputed_at = excluded.recomputed_at,
       notes = excluded.notes
     returning ${SUMMARY_COLUMNS}`,
    [
      vendorId,
      date,
      revenueTzs,
      cogsTzs,
      otherExpTzs,
      profitTzs,
      platesSold,
      platesPlannedCount,
      wastePlates,
      deniIssuedTzs,
      notes,
    ],
  );
  return upserted.rows[0]!;
}

// Recomputes with the vendor-reported waste/notes, then stamps closed_at —
// idempotent: closing an already-closed day recomputes the numbers (the
// ledger may have gained voided/late-synced rows since) but never moves
// closed_at forward, consistent with the append-mostly, no-silent-mutation
// philosophy this whole phase is built on.
export async function closeDay(
  ctx: VendorContext,
  date: string,
  wastePlates: number,
  notes?: string | null,
): Promise<DailySummaryRow> {
  return withVendorContext(ctx, async (client) => {
    await recomputeDailySummaryInTx(client, ctx.vendorId, date, wastePlates, notes ?? null);
    const closed = await client.query<DailySummaryRow>(
      `update pos.daily_summaries set closed_at = coalesce(closed_at, now())
       where vendor_id = $1 and summary_date = $2
       returning ${SUMMARY_COLUMNS}`,
      [ctx.vendorId, date],
    );
    return closed.rows[0]!;
  });
}

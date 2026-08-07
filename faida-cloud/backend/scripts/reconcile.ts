// Nightly reconciliation (Task 5): recomputes every pos.daily_summaries row
// touched in the last 7 days directly from the ledgers, and treats the
// ledger as the only authoritative source — any drift between what was
// stored and what the ledgers actually say gets logged to Sentry and
// silently overwritten with the recomputed truth. This is what catches
// summaries that went stale because a sync batch landed after a day was
// already closed (Task 4 doesn't force a recompute unless the batch itself
// carries a day_close record).
//
// Runs as a standalone script (backend/scripts/reconcile.ts), not inside
// the long-running Next.js process — see docker-compose.yml's
// reconcile-cron service for how it's scheduled. Because it exits after
// each run, an in-process Prometheus counter would never be scraped, so
// drift is pushed to a Pushgateway instead (prom-client's built-in
// support, no new dependency) rather than exposed from /api/v1/metrics.
//
// Deliberately @sentry/node, not @sentry/nextjs: @sentry/nextjs's export
// surface is conditional on being bundled by Next.js's own webpack build
// (it resolves to a reduced stub — no captureMessage, no flush — outside
// that context), confirmed live when this script first threw
// "Sentry.captureMessage is not a function" under plain tsx. @sentry/node
// is already fully present as @sentry/nextjs's own transitive dependency
// (zero new download), made an explicit dependency here rather than left
// implicit.
//
// Run manually with: DATABASE_URL=... [SENTRY_DSN=...] [PUSHGATEWAY_URL=...] npx tsx scripts/reconcile.ts
import * as Sentry from "@sentry/node";
import { Counter, Pushgateway, Registry } from "prom-client";
import { getPool, closePool } from "../src/lib/db.js";
import { recomputeDailySummary } from "../src/lib/pos/summary.js";
import type { DailySummaryRow } from "../src/lib/pos/types.js";

Sentry.init({ dsn: process.env.SENTRY_DSN, enabled: !!process.env.SENTRY_DSN, tracesSampleRate: 0 });

const RECONCILE_WINDOW_DAYS = 7;

// Every numeric field recomputeDailySummary derives from the ledgers.
// waste_plates/notes are deliberately excluded — they're vendor-reported,
// recomputeDailySummary preserves them verbatim, so they can never "drift"
// from a recompute and comparing them would just generate false positives.
const RECONCILED_FIELDS = [
  "revenue_tzs",
  "cogs_tzs",
  "other_exp_tzs",
  "profit_tzs",
  "plates_sold",
  "plates_planned",
  "deni_issued_tzs",
] as const satisfies readonly (keyof DailySummaryRow)[];

interface Drift {
  field: string;
  before: number;
  after: number;
  delta: number;
}

function diffSummary(before: DailySummaryRow, after: DailySummaryRow): Drift[] {
  const drifts: Drift[] = [];
  for (const field of RECONCILED_FIELDS) {
    const b = before[field] as number;
    const a = after[field] as number;
    if (b !== a) drifts.push({ field, before: b, after: a, delta: a - b });
  }
  return drifts;
}

async function pushDriftMetric(count: number): Promise<void> {
  const gatewayUrl = process.env.PUSHGATEWAY_URL;
  if (!gatewayUrl) {
    console.warn("PUSHGATEWAY_URL not set — skipping faida_summary_drift_total push (metric not exported this run)");
    return;
  }
  // A fresh Registry per run: this counter represents "drift found in this
  // reconciliation run", not an all-time cumulative total — a stateless
  // script has no durable place to keep a running total across invocations
  // without external storage. Pushed under a stable grouping key so each
  // night's push replaces the last at the gateway; Prometheus scrapes
  // whatever was most recently pushed as a live sample, so a dashboard
  // graphing this series over time still shows the drift trend night to
  // night even though the number itself resets each run rather than
  // accumulating forever.
  const registry = new Registry();
  const drift = new Counter({
    name: "faida_summary_drift_total",
    help: "Number of daily summaries that drifted from ledger truth in the most recent nightly reconciliation run",
    registers: [registry],
  });
  drift.inc(count);

  const gateway = new Pushgateway(gatewayUrl, {}, registry);
  await gateway.pushAdd({ jobName: "faida_reconcile" });
}

async function main() {
  const pool = getPool();

  const touched = await pool.query<{ vendor_id: string; summary_date: string }>(
    `select vendor_id, summary_date::text
     from pos.daily_summaries
     where summary_date >= current_date - $1::int
     order by vendor_id, summary_date`,
    [RECONCILE_WINDOW_DAYS],
  );

  console.log(`reconcile: checking ${touched.rows.length} summaries from the last ${RECONCILE_WINDOW_DAYS} days`);

  let driftCount = 0;

  for (const row of touched.rows) {
    const before = await pool.query<DailySummaryRow>(
      `select vendor_id, summary_date::text, revenue_tzs, cogs_tzs, other_exp_tzs, profit_tzs,
              plates_sold, plates_planned, waste_plates, deni_issued_tzs, closed_at, recomputed_at, notes
       from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
      [row.vendor_id, row.summary_date],
    );
    const beforeRow = before.rows[0];
    if (!beforeRow) continue; // deleted between the listing query and here — nothing to reconcile

    // recomputeDailySummary is vendor-scoped by design (it runs through
    // withVendorContext, the same RLS-respecting path every other write in
    // this phase uses) — role 'ops_admin' is what the RLS policies check
    // for cross-vendor access, matching how ops-only code is meant to
    // reach every vendor's rows without becoming vendor-specific itself.
    const after = await recomputeDailySummary({ vendorId: row.vendor_id, role: "ops_admin" }, row.summary_date);

    const drifts = diffSummary(beforeRow, after);
    if (drifts.length > 0) {
      driftCount++;
      console.error(`DRIFT vendor=${row.vendor_id} date=${row.summary_date}`, drifts);
      Sentry.captureMessage("pos.daily_summaries drift detected and corrected", {
        level: "error",
        extra: { vendorId: row.vendor_id, summaryDate: row.summary_date, drifts },
      });
      // recomputeDailySummary has already overwritten the stored summary
      // with the ledger-derived truth — the ledger is authoritative, no
      // separate "should I fix this" decision to make.
    }
  }

  console.log(`reconcile: ${driftCount} of ${touched.rows.length} summaries drifted and were corrected`);
  await pushDriftMetric(driftCount);
}

main()
  .catch((err) => {
    console.error("reconcile FAILED:", err);
    Sentry.captureException(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Sentry.flush(2000).catch(() => undefined);
    await closePool();
  });

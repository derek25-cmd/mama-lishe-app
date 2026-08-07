import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import type { DailySummaryRow } from "@/lib/pos";

type RouteParams = { params: Promise<{ date: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SUMMARY_COLUMNS = `vendor_id, summary_date::text, revenue_tzs, cogs_tzs, other_exp_tzs, profit_tzs,
   plates_sold, plates_planned, waste_plates, deni_issued_tzs, closed_at, recomputed_at, notes`;

export const GET = requireAuth<[RouteParams]>(
  requireRole(
    "vendor",
    "vendor_owner",
  )<[RouteParams]>(async (_req, ctx, routeCtx) => {
    const { date } = await routeCtx.params;
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "invalid_date", message: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const summary = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const result = await client.query<DailySummaryRow>(
        `select ${SUMMARY_COLUMNS} from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
        [ctx.vendorId, date],
      );
      return result.rows[0] ?? null;
    });

    if (!summary) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ summary });
  }),
);

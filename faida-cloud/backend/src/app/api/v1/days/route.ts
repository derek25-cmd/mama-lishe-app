import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import type { DailySummaryRow } from "@/lib/pos";
import { decodeCursor, parseLimit, buildPage } from "@/lib/pagination";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SUMMARY_COLUMNS = `vendor_id, summary_date::text, revenue_tzs, cogs_tzs, other_exp_tzs, profit_tzs,
   plates_sold, plates_planned, waste_plates, deni_issued_tzs, closed_at, recomputed_at, notes`;

// pos.daily_summaries' PK is (vendor_id, summary_date) — summary_date is
// already unique per vendor, so it doubles as both the cursor's sortValue
// and its tiebreaker id; there's no separate row id to page on.
export const GET = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const orderParam = url.searchParams.get("order") ?? "desc";
    const cursorParam = url.searchParams.get("cursor");
    const limit = parseLimit(url.searchParams.get("limit"));

    if (orderParam !== "asc" && orderParam !== "desc") {
      return NextResponse.json({ error: "invalid_order", allowed: ["asc", "desc"] }, { status: 400 });
    }
    if (from && !DATE_RE.test(from)) {
      return NextResponse.json({ error: "invalid_from", message: "from must be YYYY-MM-DD" }, { status: 400 });
    }
    if (to && !DATE_RE.test(to)) {
      return NextResponse.json({ error: "invalid_to", message: "to must be YYYY-MM-DD" }, { status: 400 });
    }

    let cursor = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
    const desc = orderParam === "desc";

    const rows = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const conditions = ["vendor_id = $1"];
      const params: unknown[] = [ctx.vendorId];

      if (from) {
        params.push(from);
        conditions.push(`summary_date >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`summary_date <= $${params.length}`);
      }
      if (cursor) {
        params.push(cursor.sortValue);
        const cmp = desc ? "<" : ">";
        conditions.push(`summary_date ${cmp} $${params.length}`);
      }
      params.push(limit + 1);

      const result = await client.query<DailySummaryRow>(
        `select ${SUMMARY_COLUMNS} from pos.daily_summaries
         where ${conditions.join(" and ")}
         order by summary_date ${desc ? "desc" : "asc"}
         limit $${params.length}`,
        params,
      );
      return result.rows;
    });

    const page = buildPage(rows, limit, (row) => ({ sortValue: row.summary_date, id: row.summary_date }));
    return NextResponse.json(page);
  }),
);

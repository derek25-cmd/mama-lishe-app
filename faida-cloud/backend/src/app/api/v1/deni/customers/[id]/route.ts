import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import { decodeCursor, parseLimit, buildPage } from "@/lib/pagination";

type RouteParams = { params: Promise<{ id: string }> };

interface CustomerRow {
  id: string;
  vendor_id: string;
  name: string;
  phone: string | null;
}

interface HistoryRow {
  type: "sale" | "payment";
  id: string;
  amount_tzs: number;
  at: Date;
}

export const GET = requireAuth<[RouteParams]>(
  requireRole(
    "vendor",
    "vendor_owner",
  )<[RouteParams]>(async (req, ctx, routeCtx) => {
    const { id } = await routeCtx.params;
    const url = new URL(req.url);
    const cursorParam = url.searchParams.get("cursor");
    const limit = parseLimit(url.searchParams.get("limit"));

    let cursor = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }

    const result = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const customerResult = await client.query<CustomerRow>(
        `select id, vendor_id, name, phone from pos.deni_customers where id = $1 and vendor_id = $2`,
        [id, ctx.vendorId],
      );
      const customer = customerResult.rows[0];
      if (!customer) return null;

      const balanceResult = await client.query<{ balance_tzs: string }>(
        `select
           coalesce((select sum(total_tzs) from pos.sales where vendor_id = $1 and deni_customer_id = $2 and voided = false), 0)
           - coalesce((select sum(amount_tzs) from pos.deni_payments where vendor_id = $1 and deni_customer_id = $2), 0)
           as balance_tzs`,
        [ctx.vendorId, id],
      );

      const conditions: string[] = [];
      const params: unknown[] = [ctx.vendorId, id];
      if (cursor) {
        params.push(cursor.sortValue, cursor.id);
        conditions.push(`(h.at, h.id) < ($${params.length - 1}, $${params.length})`);
      }
      params.push(limit + 1);

      const historyResult = await client.query<HistoryRow>(
        `select h.type, h.id, h.amount_tzs, h.at from (
           select 'sale'::text as type, id, total_tzs as amount_tzs, sold_at as at
             from pos.sales where vendor_id = $1 and deni_customer_id = $2 and voided = false
           union all
           select 'payment'::text as type, id, amount_tzs, paid_at as at
             from pos.deni_payments where vendor_id = $1 and deni_customer_id = $2
         ) h
         ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
         order by h.at desc, h.id desc
         limit $${params.length}`,
        params,
      );

      return {
        customer,
        balanceTzs: Number(balanceResult.rows[0]!.balance_tzs),
        historyRows: historyResult.rows,
      };
    });

    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const historyPage = buildPage(result.historyRows, limit, (row) => ({
      sortValue: row.at.toISOString(),
      id: row.id,
    }));

    return NextResponse.json({
      customer: result.customer,
      balanceTzs: result.balanceTzs,
      history: historyPage,
    });
  }),
);

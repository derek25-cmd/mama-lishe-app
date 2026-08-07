import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import { decodeCursor, parseLimit, buildPage } from "@/lib/pagination";

interface DeniCustomerListRow {
  id: string;
  vendor_id: string;
  name: string;
  phone: string | null;
  balance_tzs: string; // bigint-safe arithmetic comes back as text
}

const SETTLED_VALUES = ["open", "settled"] as const;

// deni_customers has no timestamp column (it's a small, per-vendor lookup
// table — informal credit customers, realistically dozens not thousands),
// so this pages on (name, id) rather than a dedicated index. Flagged as a
// deliberate simplification, not an oversight: a dedicated index/cursor
// column would be worth adding if this list ever needs to scale past
// what an unindexed sort over one vendor's rows handles comfortably.
export const GET = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const url = new URL(req.url);
    const settled = url.searchParams.get("settled"); // 'open' | 'settled' | absent
    const orderParam = url.searchParams.get("order") ?? "asc";
    const cursorParam = url.searchParams.get("cursor");
    const limit = parseLimit(url.searchParams.get("limit"));

    if (orderParam !== "asc" && orderParam !== "desc") {
      return NextResponse.json({ error: "invalid_order", allowed: ["asc", "desc"] }, { status: 400 });
    }
    if (settled !== null && !(SETTLED_VALUES as readonly string[]).includes(settled)) {
      return NextResponse.json({ error: "invalid_settled", allowed: SETTLED_VALUES }, { status: 400 });
    }

    let cursor = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
    const desc = orderParam === "desc";

    const rows = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const conditions = ["dc.vendor_id = $1"];
      const params: unknown[] = [ctx.vendorId];

      if (cursor) {
        params.push(cursor.sortValue, cursor.id);
        const cmp = desc ? "<" : ">";
        conditions.push(`(dc.name, dc.id) ${cmp} ($${params.length - 1}, $${params.length})`);
      }
      if (settled === "open") conditions.push("(coalesce(s.total, 0) - coalesce(p.total, 0)) > 0");
      if (settled === "settled") conditions.push("(coalesce(s.total, 0) - coalesce(p.total, 0)) = 0");
      params.push(limit + 1);

      const result = await client.query<DeniCustomerListRow>(
        `select dc.id, dc.vendor_id, dc.name, dc.phone,
                (coalesce(s.total, 0) - coalesce(p.total, 0))::text as balance_tzs
         from pos.deni_customers dc
         left join (
           select deni_customer_id, sum(total_tzs) as total from pos.sales
           where vendor_id = $1 and voided = false group by deni_customer_id
         ) s on s.deni_customer_id = dc.id
         left join (
           select deni_customer_id, sum(amount_tzs) as total from pos.deni_payments
           where vendor_id = $1 group by deni_customer_id
         ) p on p.deni_customer_id = dc.id
         where ${conditions.join(" and ")}
         order by dc.name ${desc ? "desc" : "asc"}, dc.id ${desc ? "desc" : "asc"}
         limit $${params.length}`,
        params,
      );
      return result.rows;
    });

    const page = buildPage(rows, limit, (row) => ({ sortValue: row.name, id: row.id }));
    return NextResponse.json({
      ...page,
      data: page.data.map((row) => ({ ...row, balance_tzs: Number(row.balance_tzs) })),
    });
  }),
);

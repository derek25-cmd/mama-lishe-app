import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import { recordExpense, type ExpenseRow } from "@/lib/pos";
import { decodeCursor, parseLimit, buildPage } from "@/lib/pagination";

const CATEGORIES = ["malighafi", "mkaa", "usafiri", "kodi", "maji", "nyingine"] as const;

const RecordExpenseBody = z.object({
  clientId: z.string().min(1).max(64),
  spentAt: z.string().datetime(),
  category: z.enum(CATEGORIES),
  description: z.string().min(1).max(500).optional(),
  amountTzs: z.number().int().min(0),
  planId: z.string().uuid().optional(),
});

export const POST = requireAuth(
  requireRole("vendor", "vendor_owner")(async (req, ctx) => {
    const parsed = RecordExpenseBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await recordExpense(ctx, {
      clientId: parsed.data.clientId,
      spentAt: new Date(parsed.data.spentAt),
      category: parsed.data.category,
      description: parsed.data.description ?? null,
      amountTzs: parsed.data.amountTzs,
      planId: parsed.data.planId ?? null,
    });

    return NextResponse.json({ expense: result.expense }, { status: result.created ? 201 : 200 });
  }),
);

const SORT_COLUMNS = { spent_at: "spent_at" } as const;
type SortKey = keyof typeof SORT_COLUMNS;

export const GET = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const category = url.searchParams.get("category");
    const sortParam = url.searchParams.get("sort") ?? "spent_at";
    const orderParam = url.searchParams.get("order") ?? "desc";
    const cursorParam = url.searchParams.get("cursor");
    const limit = parseLimit(url.searchParams.get("limit"));

    if (!(sortParam in SORT_COLUMNS)) {
      return NextResponse.json({ error: "invalid_sort", allowed: Object.keys(SORT_COLUMNS) }, { status: 400 });
    }
    if (orderParam !== "asc" && orderParam !== "desc") {
      return NextResponse.json({ error: "invalid_order", allowed: ["asc", "desc"] }, { status: 400 });
    }
    if (category && !(CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: "invalid_category", allowed: CATEGORIES }, { status: 400 });
    }

    let cursor = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }

    const sortColumn = SORT_COLUMNS[sortParam as SortKey];
    const desc = orderParam === "desc";

    const rows = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const conditions = ["vendor_id = $1"];
      const params: unknown[] = [ctx.vendorId];

      if (from) {
        params.push(from);
        conditions.push(`spent_at >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`spent_at < $${params.length}`);
      }
      if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }
      if (cursor) {
        params.push(cursor.sortValue, cursor.id);
        const cmp = desc ? "<" : ">";
        conditions.push(`(${sortColumn}, id) ${cmp} ($${params.length - 1}, $${params.length})`);
      }
      params.push(limit + 1);

      const result = await client.query<ExpenseRow>(
        `select id, vendor_id, client_id, spent_at, category, description, amount_tzs, plan_id
         from pos.expenses
         where ${conditions.join(" and ")}
         order by ${sortColumn} ${desc ? "desc" : "asc"}, id ${desc ? "desc" : "asc"}
         limit $${params.length}`,
        params,
      );
      return result.rows;
    });

    const page = buildPage(rows, limit, (row) => ({ sortValue: row.spent_at.toISOString(), id: row.id }));
    return NextResponse.json(page);
  }),
);

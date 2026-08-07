import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import { recordSale, type SaleRow } from "@/lib/pos";
import { decodeCursor, parseLimit, buildPage } from "@/lib/pagination";

const PAYMENT_METHODS = ["cash", "mpesa", "tigopesa", "airtel", "deni"] as const;

const RecordSaleBody = z
  .object({
    clientId: z.string().min(1).max(64),
    soldAt: z.string().datetime(),
    branchId: z.string().uuid().optional(),
    recipeId: z.string().uuid().optional(),
    itemName: z.string().min(1).max(200).optional(),
    quantity: z.number().int().min(1),
    unitPriceTzs: z.number().int().min(0),
    totalTzs: z.number().int().min(0),
    paymentMethod: z.enum(PAYMENT_METHODS),
    deniCustomerName: z.string().min(1).max(200).optional(),
  })
  .refine((body) => body.paymentMethod !== "deni" || !!body.deniCustomerName, {
    message: "deniCustomerName is required when paymentMethod is 'deni'",
    path: ["deniCustomerName"],
  });

export const POST = requireAuth(
  requireRole("vendor", "vendor_owner")(async (req, ctx) => {
    const parsed = RecordSaleBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await recordSale(ctx, {
      clientId: parsed.data.clientId,
      soldAt: new Date(parsed.data.soldAt),
      branchId: parsed.data.branchId ?? null,
      recipeId: parsed.data.recipeId ?? null,
      itemName: parsed.data.itemName ?? null,
      quantity: parsed.data.quantity,
      unitPriceTzs: parsed.data.unitPriceTzs,
      totalTzs: parsed.data.totalTzs,
      paymentMethod: parsed.data.paymentMethod,
      deniCustomerName: parsed.data.deniCustomerName ?? null,
    });

    return NextResponse.json(
      { sale: result.sale, warnings: result.warnings },
      { status: result.created ? 201 : 200 },
    );
  }),
);

const SORT_COLUMNS = { sold_at: "sold_at" } as const;
type SortKey = keyof typeof SORT_COLUMNS;

const VOIDED_VALUES = ["true", "false"] as const;

export const GET = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const paymentMethod = url.searchParams.get("paymentMethod");
    const voided = url.searchParams.get("voided");
    const sortParam = url.searchParams.get("sort") ?? "sold_at";
    const orderParam = url.searchParams.get("order") ?? "desc";
    const cursorParam = url.searchParams.get("cursor");
    const limit = parseLimit(url.searchParams.get("limit"));

    if (!(sortParam in SORT_COLUMNS)) {
      return NextResponse.json({ error: "invalid_sort", allowed: Object.keys(SORT_COLUMNS) }, { status: 400 });
    }
    if (orderParam !== "asc" && orderParam !== "desc") {
      return NextResponse.json({ error: "invalid_order", allowed: ["asc", "desc"] }, { status: 400 });
    }
    if (paymentMethod && !(PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
      return NextResponse.json({ error: "invalid_payment_method", allowed: PAYMENT_METHODS }, { status: 400 });
    }
    if (voided !== null && !(VOIDED_VALUES as readonly string[]).includes(voided)) {
      return NextResponse.json({ error: "invalid_voided", allowed: VOIDED_VALUES }, { status: 400 });
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
        conditions.push(`sold_at >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        conditions.push(`sold_at < $${params.length}`);
      }
      if (paymentMethod) {
        params.push(paymentMethod);
        conditions.push(`payment_method = $${params.length}`);
      }
      if (voided !== null) {
        params.push(voided === "true");
        conditions.push(`voided = $${params.length}`);
      }
      if (cursor) {
        params.push(cursor.sortValue, cursor.id);
        const cmp = desc ? "<" : ">";
        conditions.push(`(${sortColumn}, id) ${cmp} ($${params.length - 1}, $${params.length})`);
      }
      params.push(limit + 1);

      const result = await client.query<SaleRow>(
        `select id, vendor_id, branch_id, client_id, sold_at, received_at, recipe_id, item_name,
                quantity, unit_price_tzs, total_tzs, payment_method, deni_customer_id,
                voided, void_reason, voided_at
         from pos.sales
         where ${conditions.join(" and ")}
         order by ${sortColumn} ${desc ? "desc" : "asc"}, id ${desc ? "desc" : "asc"}
         limit $${params.length}`,
        params,
      );
      return result.rows;
    });

    const page = buildPage(rows, limit, (row) => ({ sortValue: row.sold_at.toISOString(), id: row.id }));
    return NextResponse.json(page);
  }),
);

import { ulid } from "ulid";
import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";
import { computePlanCosting, PlanRequestBody, priceFreshness, VendorMarketNotSetError } from "@/lib/costing/plan";

const CreatePlanBody = PlanRequestBody.extend({
  client_id: z.string().min(1).max(64).optional(),
  plan_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "plan_date must be YYYY-MM-DD")
    .optional(),
});

interface CookPlanRow {
  id: string;
  client_id: string;
  plan_date: string;
  status: string;
  planned_cost_tzs: number;
  actual_cost_tzs: number | null;
  price_week: string | null;
  created_at: string;
}

// Persists a costing result. Idempotent on (vendor_id, client_id): a retried
// request with the same client_id (mobile app offline-sync, network retry)
// never creates a second plan or duplicate item/shopping rows — the insert
// simply no-ops on conflict and the caller gets back the plan that already
// exists. Note that on a replay, the returned costing numbers (lines,
// dishes, total_cost_tzs) are freshly recomputed from current prices, not
// re-read from the original insert — cook_plan_items/cook_plan_shopping
// grant no delete/full-upsert (RLS migration 009), so those rows are never
// rewritten after first insert. The persisted `id`/`status`/`plan_date`
// always reflect the original request.
export const POST = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const parsed = CreatePlanBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const clientId = parsed.data.client_id ?? ulid();
    const planDate = parsed.data.plan_date ?? new Date().toISOString().slice(0, 10);

    try {
      const { result } = await computePlanCosting(ctx, parsed.data.items, parsed.data.target_margin_pct);

      const plan = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
        const inserted = await client.query<CookPlanRow>(
          `insert into costing.cook_plans (vendor_id, client_id, plan_date, status, planned_cost_tzs, price_week)
           values ($1, $2, $3, 'planned', $4, $5)
           on conflict (vendor_id, client_id) do nothing
           returning id, client_id, plan_date::text, status, planned_cost_tzs, actual_cost_tzs, price_week::text, created_at`,
          [ctx.vendorId, clientId, planDate, result.total_cost_tzs, result.price_week],
        );

        if (inserted.rows[0]) {
          const planRow = inserted.rows[0];
          for (const dish of result.dishes) {
            await client.query(
              `insert into costing.cook_plan_items (plan_id, recipe_id, plates, cost_per_plate_tzs, recommended_price_tzs)
               values ($1, $2, $3, $4, $5)`,
              [planRow.id, dish.recipe_id, dish.plates, dish.cost_per_plate_tzs, dish.recommended_price_tzs],
            );
          }
          for (const line of result.lines) {
            await client.query(
              `insert into costing.cook_plan_shopping (plan_id, ingredient_id, qty_canonical, display_unit, display_qty, est_cost_tzs)
               values ($1, $2, $3, $4, $5, $6)`,
              [planRow.id, line.ingredient_id, line.qty_canonical_g, line.display_unit, line.display_qty, line.line_cost_tzs],
            );
          }
          return planRow;
        }

        // Conflict: a plan with this (vendor_id, client_id) already exists — replay.
        const existing = await client.query<CookPlanRow>(
          `select id, client_id, plan_date::text, status, planned_cost_tzs, actual_cost_tzs, price_week::text, created_at
           from costing.cook_plans where vendor_id = $1 and client_id = $2`,
          [ctx.vendorId, clientId],
        );
        return existing.rows[0]!;
      });

      return NextResponse.json(
        {
          id: plan.id,
          client_id: plan.client_id,
          plan_date: plan.plan_date,
          status: plan.status,
          ...result,
          price_freshness: priceFreshness(result.price_week),
        },
        { status: 201 },
      );
    } catch (err) {
      if (err instanceof VendorMarketNotSetError) {
        return NextResponse.json({ error: "vendor_market_not_set" }, { status: 422 });
      }
      if (
        err instanceof Error &&
        (err.message.includes("could not be resolved") || err.message.includes("no base recipe named"))
      ) {
        return NextResponse.json({ error: "unknown_recipe", message: err.message }, { status: 422 });
      }
      throw err;
    }
  }),
);

// Whitelisted so the sort column can be safely interpolated into SQL —
// never built from the raw query string.
const SORT_COLUMNS = { created_at: "created_at", plan_date: "plan_date" } as const;
type SortKey = keyof typeof SORT_COLUMNS;

interface Cursor {
  sortValue: string;
  id: string;
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as Cursor).sortValue === "string" &&
      typeof (parsed as Cursor).id === "string"
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export const GET = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const sortParam = (url.searchParams.get("sort") ?? "created_at") as string;
    const orderParam = url.searchParams.get("order") ?? "desc";
    const limitParam = url.searchParams.get("limit");
    const cursorParam = url.searchParams.get("cursor");

    if (!(sortParam in SORT_COLUMNS)) {
      return NextResponse.json({ error: "invalid_sort", allowed: Object.keys(SORT_COLUMNS) }, { status: 400 });
    }
    if (orderParam !== "asc" && orderParam !== "desc") {
      return NextResponse.json({ error: "invalid_order", allowed: ["asc", "desc"] }, { status: 400 });
    }
    const sortColumn = SORT_COLUMNS[sortParam as SortKey];
    const desc = orderParam === "desc";
    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);

    let cursor: Cursor | null = null;
    if (cursorParam) {
      cursor = decodeCursor(cursorParam);
      if (!cursor) return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }

    const rows = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const conditions = ["vendor_id = $1"];
      const params: unknown[] = [ctx.vendorId];

      if (date) {
        params.push(date);
        conditions.push(`plan_date = $${params.length}`);
      }
      if (cursor) {
        params.push(cursor.sortValue, cursor.id);
        const cmp = desc ? "<" : ">";
        conditions.push(`(${sortColumn}, id) ${cmp} ($${params.length - 1}, $${params.length})`);
      }
      params.push(limit + 1);

      const result = await client.query<CookPlanRow>(
        `select id, client_id, plan_date::text, status, planned_cost_tzs, actual_cost_tzs, price_week::text, created_at::text
         from costing.cook_plans
         where ${conditions.join(" and ")}
         order by ${sortColumn} ${desc ? "desc" : "asc"}, id ${desc ? "desc" : "asc"}
         limit $${params.length}`,
        params,
      );
      return result.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ sortValue: last[sortParam as SortKey], id: last.id }) : null;

    return NextResponse.json({ data: page, next_cursor: nextCursor });
  }),
);

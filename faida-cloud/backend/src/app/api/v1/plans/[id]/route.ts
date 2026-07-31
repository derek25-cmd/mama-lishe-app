import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";

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

interface CookPlanItemRow {
  id: string;
  recipe_id: string;
  plates: number;
  cost_per_plate_tzs: number;
  recommended_price_tzs: number;
}

interface CookPlanShoppingRow {
  id: string;
  ingredient_id: string;
  qty_canonical: string;
  display_unit: string;
  display_qty: string;
  est_cost_tzs: number;
  actual_cost_tzs: number | null;
  bought: boolean;
}

type RouteParams = { params: Promise<{ id: string }> };

export const GET = requireAuth<[RouteParams]>(
  requireRole(
    "vendor",
    "vendor_owner",
  )<[RouteParams]>(async (_req, ctx, routeCtx) => {
    const { id } = await routeCtx.params;

    const data = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      // RLS restricts this to the caller's own plan regardless of role —
      // the plain `where id = $1` (no vendor_id check needed here) is safe
      // because the policy is FORCE ROW LEVEL SECURITY on cook_plans.
      const planResult = await client.query<CookPlanRow>(
        `select id, client_id, plan_date::text, status, planned_cost_tzs, actual_cost_tzs, price_week::text, created_at
         from costing.cook_plans where id = $1`,
        [id],
      );
      const plan = planResult.rows[0];
      if (!plan) return null;

      const items = await client.query<CookPlanItemRow>(
        `select id, recipe_id, plates, cost_per_plate_tzs, recommended_price_tzs
         from costing.cook_plan_items where plan_id = $1`,
        [id],
      );
      const shopping = await client.query<CookPlanShoppingRow>(
        `select id, ingredient_id, qty_canonical::text, display_unit, display_qty::text, est_cost_tzs, actual_cost_tzs, bought
         from costing.cook_plan_shopping where plan_id = $1`,
        [id],
      );

      return { plan, items: items.rows, shopping: shopping.rows };
    });

    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(data);
  }),
);

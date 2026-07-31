import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";

type RouteParams = { params: Promise<{ id: string }> };

const ShoppingConfirmBody = z.object({
  shopping: z
    .array(
      z.object({
        shopping_id: z.string().uuid(),
        actual_cost_tzs: z.number().int().min(0),
      }),
    )
    .min(1),
});

interface ShoppingRow {
  id: string;
  ingredient_id: string;
  display_unit: string;
  display_qty: string;
  est_cost_tzs: number;
}

interface VendorMarketRow {
  market_id: string | null;
}

// Vendor reports what she actually paid while shopping. Updates each
// cook_plan_shopping row, recomputes the plan's actual cost, marks it
// shopping_done, and — this is the feed for Phase 6's price-crowdsourcing
// pipeline — inserts one price.submissions row per confirmed line so ops
// can fold real vendor spend back into next week's market_prices. Idempotent
// on (plan_id, shopping_id) via migration 014's partial unique index: a
// retried confirm updates the shopping rows again (harmless, same values)
// but never double-submits the same price observation.
export const POST = requireAuth<[RouteParams]>(
  requireRole(
    "vendor",
    "vendor_owner",
  )<[RouteParams]>(async (req, ctx, routeCtx) => {
    const { id: planId } = await routeCtx.params;
    const parsed = ShoppingConfirmBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      const planCheck = await client.query<{ id: string }>(`select id from costing.cook_plans where id = $1`, [
        planId,
      ]);
      if (!planCheck.rows[0]) return null;

      const vendorRow = await client.query<VendorMarketRow>(
        `select market_id from vendor.vendors where id = $1`,
        [ctx.vendorId],
      );
      const marketId = vendorRow.rows[0]?.market_id ?? null;

      for (const confirmed of parsed.data.shopping) {
        const updated = await client.query<ShoppingRow>(
          `update costing.cook_plan_shopping
           set actual_cost_tzs = $1, bought = true
           where id = $2 and plan_id = $3
           returning id, ingredient_id, display_unit, display_qty::text, est_cost_tzs`,
          [confirmed.actual_cost_tzs, confirmed.shopping_id, planId],
        );
        const shoppingRow = updated.rows[0];
        if (!shoppingRow) continue; // shopping_id didn't belong to this plan — silently skipped, not an error

        if (marketId) {
          await client.query(
            `insert into price.submissions
               (vendor_id, market_id, ingredient_id, unit_name_sw, quantity, price_tzs, source, status, plan_id, shopping_id)
             values ($1, $2, $3, $4, $5, $6, 'shopping', 'pending', $7, $8)
             on conflict (plan_id, shopping_id) where plan_id is not null and shopping_id is not null do nothing`,
            [
              ctx.vendorId,
              marketId,
              shoppingRow.ingredient_id,
              shoppingRow.display_unit,
              shoppingRow.display_qty,
              confirmed.actual_cost_tzs,
              planId,
              shoppingRow.id,
            ],
          );
        }
      }

      const totals = await client.query<{ planned_cost_tzs: number; actual_cost_tzs: number | null }>(
        `select p.planned_cost_tzs,
                (select sum(coalesce(s.actual_cost_tzs, s.est_cost_tzs)) from costing.cook_plan_shopping s where s.plan_id = p.id) as actual_cost_tzs
         from costing.cook_plans p where p.id = $1`,
        [planId],
      );
      const { planned_cost_tzs: plannedCostTzs, actual_cost_tzs: actualCostTzs } = totals.rows[0]!;

      const updatedPlan = await client.query<{
        id: string;
        status: string;
        planned_cost_tzs: number;
        actual_cost_tzs: number | null;
      }>(
        `update costing.cook_plans
         set status = 'shopping_done', actual_cost_tzs = $1
         where id = $2
         returning id, status, planned_cost_tzs, actual_cost_tzs`,
        [actualCostTzs, planId],
      );

      return {
        plan: updatedPlan.rows[0]!,
        delta_tzs: actualCostTzs === null ? null : actualCostTzs - plannedCostTzs,
      };
    });

    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(result);
  }),
);

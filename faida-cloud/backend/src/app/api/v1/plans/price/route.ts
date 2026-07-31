import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { computePlanCosting, PlanRequestBody, priceFreshness, VendorMarketNotSetError } from "@/lib/costing/plan";

// Dry-run costing: no persistence. Target p95 < 150ms warm (cache-aside hit
// on prices/units/ingredient-meta) — see repository.ts's cache-aside layer.
export const POST = requireAuth(
  requireRole("vendor", "vendor_owner")(async (req, ctx) => {
    const parsed = PlanRequestBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    try {
      const { result } = await computePlanCosting(ctx, parsed.data.items, parsed.data.target_margin_pct);
      return NextResponse.json({ ...result, price_freshness: priceFreshness(result.price_week) });
    } catch (err) {
      if (err instanceof VendorMarketNotSetError) {
        return NextResponse.json({ error: "vendor_market_not_set" }, { status: 422 });
      }
      if (err instanceof Error && (err.message.includes("could not be resolved") || err.message.includes("no base recipe named"))) {
        return NextResponse.json({ error: "unknown_recipe", message: err.message }, { status: 422 });
      }
      throw err;
    }
  }),
);

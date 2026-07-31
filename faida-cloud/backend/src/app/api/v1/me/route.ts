import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";

// Reference implementation: every authenticated route that touches
// vendor-scoped tables should look like this — requireAuth for the token,
// withVendorContext for the query, never a raw pool query. RLS (Phase 1)
// engages via the SET LOCAL app.vendor_id inside withVendorContext, so this
// can only ever return the caller's own row.
export const GET = requireAuth(async (_req, ctx) => {
  const vendor = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
    const result = await client.query(
      `select id, phone, display_name, business_type, market_id, region_id,
              language, target_margin_pct, points, status, role
       from vendor.vendors where id = $1`,
      [ctx.vendorId],
    );
    return result.rows[0] ?? null;
  });

  if (!vendor) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(vendor);
});

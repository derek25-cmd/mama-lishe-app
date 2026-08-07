import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { voidSale, SaleNotFoundError } from "@/lib/pos";

type RouteParams = { params: Promise<{ id: string }> };

const VoidSaleBody = z.object({ reason: z.string().min(1).max(500) });

export const POST = requireAuth<[RouteParams]>(
  requireRole(
    "vendor",
    "vendor_owner",
  )<[RouteParams]>(async (req, ctx, routeCtx) => {
    const { id } = await routeCtx.params;
    const parsed = VoidSaleBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    try {
      const sale = await voidSale(ctx, id, parsed.data.reason);
      return NextResponse.json({ sale });
    } catch (err) {
      if (err instanceof SaleNotFoundError) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      throw err;
    }
  }),
);

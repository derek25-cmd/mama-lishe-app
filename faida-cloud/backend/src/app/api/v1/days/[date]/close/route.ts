import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { closeDay } from "@/lib/pos";

type RouteParams = { params: Promise<{ date: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CloseDayBody = z.object({
  wastePlates: z.number().int().min(0),
  notes: z.string().max(1000).optional(),
});

export const POST = requireAuth<[RouteParams]>(
  requireRole(
    "vendor",
    "vendor_owner",
  )<[RouteParams]>(async (req, ctx, routeCtx) => {
    const { date } = await routeCtx.params;
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: "invalid_date", message: "date must be YYYY-MM-DD" }, { status: 400 });
    }

    const parsed = CloseDayBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    const summary = await closeDay(ctx, date, parsed.data.wastePlates, parsed.data.notes ?? null);
    return NextResponse.json({ summary });
  }),
);

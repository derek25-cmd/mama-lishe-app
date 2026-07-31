import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { logoutAll } from "@/lib/auth/session";

export const POST = requireAuth(async (_req, ctx) => {
  await logoutAll(ctx.vendorId);
  return NextResponse.json({ ok: true });
});

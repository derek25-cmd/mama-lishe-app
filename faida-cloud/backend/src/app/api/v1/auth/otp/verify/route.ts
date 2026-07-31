import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@/lib/auth/phone";
import { verifyOtp } from "@/lib/auth/otp";
import { findOrCreateVendorByPhone } from "@/lib/auth/vendor";
import { createSession } from "@/lib/auth/session";

const Body = z.object({ phone: z.string().min(1), code: z.string().length(6) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const result = await verifyOtp(phone, parsed.data.code);
  if (result !== "ok") {
    return NextResponse.json({ error: "invalid_grant" }, { status: 401 });
  }

  const vendor = await findOrCreateVendorByPhone(phone);
  const deviceLabel = req.headers.get("user-agent")?.slice(0, 200);
  const tokens = await createSession({ id: vendor.id, role: vendor.role, marketId: vendor.market_id }, deviceLabel);

  return NextResponse.json(tokens, { status: 200 });
}

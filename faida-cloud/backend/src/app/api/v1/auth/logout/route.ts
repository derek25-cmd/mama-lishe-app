import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logout } from "@/lib/auth/session";

const Body = z.object({ refreshToken: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }
  await logout(parsed.data.refreshToken);
  return NextResponse.json({ ok: true });
}

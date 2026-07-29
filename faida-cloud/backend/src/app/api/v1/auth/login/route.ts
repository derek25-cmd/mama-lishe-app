import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signAccessToken, signRefreshToken } from "@/lib/auth/jwt";

const Body = z.object({ phone: z.string().min(9), otp: z.string().length(6) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }
  // TODO: verify OTP against Redis, load user + role from Postgres
  const userId = "TODO";
  const role = "owner";
  return NextResponse.json({
    accessToken: signAccessToken(userId, role),
    refreshToken: signRefreshToken(userId, role),
  });
}

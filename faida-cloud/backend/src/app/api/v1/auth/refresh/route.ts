import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rotateRefreshToken } from "@/lib/auth/session";

const Body = z.object({ refreshToken: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const result = await rotateRefreshToken(parsed.data.refreshToken);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_grant", reason: result.reason }, { status: 401 });
  }

  return NextResponse.json(result.tokens, { status: 200 });
}

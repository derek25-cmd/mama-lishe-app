import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { consumeAuthorizationCode } from "@/lib/auth/oauth";
import { verifyPkce } from "@/lib/auth/pkce";
import { createSession, rotateRefreshToken } from "@/lib/auth/session";
import { getVendorById } from "@/lib/auth/vendor";

const AuthCodeBody = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  redirect_uri: z.string().min(1),
  client_id: z.string().min(1),
  code_verifier: z.string().min(1),
});

const RefreshBody = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
});

const Body = z.discriminatedUnion("grant_type", [AuthCodeBody, RefreshBody]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  if (parsed.data.grant_type === "authorization_code") {
    const { code, redirect_uri, client_id, code_verifier } = parsed.data;

    const record = await consumeAuthorizationCode(code);
    if (!record) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (record.expires_at.getTime() < Date.now()) {
      return NextResponse.json({ error: "invalid_grant", error_description: "code expired" }, { status: 400 });
    }
    if (record.client_id !== client_id || record.redirect_uri !== redirect_uri) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (!verifyPkce(code_verifier, record.code_challenge)) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        { status: 400 },
      );
    }

    const vendor = await getVendorById(record.vendor_id);
    if (!vendor) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }

    const tokens = await createSession(
      { id: vendor.id, role: vendor.role, marketId: vendor.market_id },
      `oauth:${client_id}`,
      record.scopes.join(" "),
    );

    return NextResponse.json({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      token_type: "Bearer",
      scope: record.scopes.join(" "),
    });
  }

  const result = await rotateRefreshToken(parsed.data.refresh_token);
  if (!result.ok) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }
  return NextResponse.json({
    access_token: result.tokens.accessToken,
    refresh_token: result.tokens.refreshToken,
    token_type: "Bearer",
  });
}

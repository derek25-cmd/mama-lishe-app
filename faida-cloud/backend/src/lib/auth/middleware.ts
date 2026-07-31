import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, TokenVerificationError } from "@/lib/auth/jwt";

export interface AuthContext {
  vendorId: string;
  role: string;
  marketId: string | null;
  scopes: string[];
}

// Extra is whatever Next.js passes after `req` — for dynamic segments,
// `{ params: Promise<{ id: string }> }`. Defaults to `[]` so every existing
// non-dynamic route (`AuthedHandler` with no third argument) is unaffected.
export type AuthedHandler<Extra extends unknown[] = []> = (
  req: NextRequest,
  ctx: AuthContext,
  ...extra: Extra
) => Promise<NextResponse>;

// Extracts + verifies the Bearer access token, attaches {vendorId, role,
// marketId, scopes} to the handler, 401 on any failure (missing header, bad
// signature, expired, malformed). This is deliberately a per-route wrapper,
// not global Next.js middleware — JWT verification needs to run in the
// route handler's own Node runtime, not the Edge runtime the top-level
// middleware.ts runs in.
export function requireAuth<Extra extends unknown[] = []>(handler: AuthedHandler<Extra>) {
  return async (req: NextRequest, ...extra: Extra): Promise<NextResponse> => {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice("Bearer ".length);
    try {
      const claims = await verifyAccessToken(token);
      const scopes = claims.scope ? claims.scope.split(" ") : [];
      return await handler(
        req,
        { vendorId: claims.sub, role: claims.role, marketId: claims.marketId, scopes },
        ...extra,
      );
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      throw err;
    }
  };
}

// Roles: vendor, vendor_owner, ops_curator, ops_admin, partner_readonly
// (DOC 02 §5, adapted). No hierarchy — each route lists exactly the roles
// allowed, since e.g. ops_curator isn't a superset of vendor.
export function requireRole(...roles: string[]) {
  return <Extra extends unknown[] = []>(handler: AuthedHandler<Extra>): AuthedHandler<Extra> => {
    return async (req, ctx, ...extra) => {
      if (!roles.includes(ctx.role)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return handler(req, ctx, ...extra);
    };
  };
}

// For OAuth-issued access tokens, which carry a `scope` claim instead of
// (or alongside) a role. Vendor-issued tokens from the OTP flow have no
// scopes, so requireScope always 403s them — that's correct, OTP sessions
// aren't OAuth sessions.
export function requireScope(scope: string) {
  return <Extra extends unknown[] = []>(handler: AuthedHandler<Extra>): AuthedHandler<Extra> => {
    return async (req, ctx, ...extra) => {
      if (!ctx.scopes.includes(scope)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return handler(req, ctx, ...extra);
    };
  };
}

import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken, TokenVerificationError } from "@/lib/auth/jwt";

export interface AuthContext {
  vendorId: string;
  role: string;
  marketId: string | null;
  scopes: string[];
}

export type AuthedHandler = (req: NextRequest, ctx: AuthContext) => Promise<NextResponse>;

// Extracts + verifies the Bearer access token, attaches {vendorId, role,
// marketId, scopes} to the handler, 401 on any failure (missing header, bad
// signature, expired, malformed). This is deliberately a per-route wrapper,
// not global Next.js middleware — JWT verification needs to run in the
// route handler's own Node runtime, not the Edge runtime the top-level
// middleware.ts runs in.
export function requireAuth(handler: AuthedHandler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice("Bearer ".length);
    try {
      const claims = await verifyAccessToken(token);
      const scopes = claims.scope ? claims.scope.split(" ") : [];
      return await handler(req, { vendorId: claims.sub, role: claims.role, marketId: claims.marketId, scopes });
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
  return (handler: AuthedHandler): AuthedHandler => {
    return async (req, ctx) => {
      if (!roles.includes(ctx.role)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return handler(req, ctx);
    };
  };
}

// For OAuth-issued access tokens, which carry a `scope` claim instead of
// (or alongside) a role. Vendor-issued tokens from the OTP flow have no
// scopes, so requireScope always 403s them — that's correct, OTP sessions
// aren't OAuth sessions.
export function requireScope(scope: string) {
  return (handler: AuthedHandler): AuthedHandler => {
    return async (req, ctx) => {
      if (!ctx.scopes.includes(scope)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      return handler(req, ctx);
    };
  };
}

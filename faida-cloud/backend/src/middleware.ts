import { NextRequest, NextResponse } from "next/server";

// /api/v1/metrics has no app-level auth — it's scraped by Prometheus over the
// internal Docker network only, never reachable from nginx's public vhost.
//
// auth/otp/* (no session exists yet), auth/refresh and auth/logout (the
// refresh token itself is the credential) and oauth/token (client
// authenticates via PKCE/body per RFC 6749, not a bearer token) are public
// at this gate. auth/logout-all, /me, and oauth/authorize all need an
// existing session and are NOT listed here — requireAuth() enforces those
// in the route handler itself.
const PUBLIC_PATHS = [
  "/api/v1/health",
  "/api/v1/metrics",
  "/api/v1/auth/otp/request",
  "/api/v1/auth/otp/verify",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
  "/api/v1/oauth/token",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Exact match, not startsWith — "/api/v1/auth/logout" as a prefix would
  // otherwise also match "/api/v1/auth/logout-all", which must stay behind
  // the bearer-token gate.
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Full JWT verification happens in route handlers (Node runtime);
  // middleware only gates for presence of a bearer token.
  return NextResponse.next();
}

export const config = { matcher: "/api/v1/:path*" };

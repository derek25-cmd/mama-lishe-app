import { NextRequest, NextResponse } from "next/server";

// /api/v1/metrics has no app-level auth — it's scraped by Prometheus over the
// internal Docker network only, never reachable from nginx's public vhost.
const PUBLIC_PATHS = ["/api/v1/health", "/api/v1/metrics", "/api/v1/auth/login", "/api/v1/auth/callback"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Full JWT verification happens in route handlers (Node runtime);
  // middleware only gates for presence of a bearer token.
  return NextResponse.next();
}

export const config = { matcher: "/api/v1/:path*" };

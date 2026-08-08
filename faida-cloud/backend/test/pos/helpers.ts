import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import type { VendorContext } from "@/lib/db";
import { signAccessToken } from "@/lib/auth/jwt";

// Creates a bare vendor row directly (no OTP flow) — this suite is about
// POS/sync correctness, not auth, and the property test alone needs
// hundreds of isolated vendors. Going through real OTP login per vendor
// would burn the phone-level rate limit (5/15min, Phase 2) almost
// immediately and make 500 property-test iterations impractically slow;
// a direct insert is what Phase 3's own scripts (seed.ts) do for the same
// reason. requireAuth only cares that a token verifies, not how the
// vendor row or token came to exist.
export async function createTestVendor(): Promise<{ vendorId: string; ctx: VendorContext; accessToken: string }> {
  const vendorId = randomUUID();
  const phone = `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
  await getPool().query(
    `insert into vendor.vendors (id, phone, display_name, business_type, role, status)
     values ($1, $2, $2, 'mama_lishe', 'vendor', 'active')`,
    [vendorId, phone],
  );
  const accessToken = await signAccessToken({ sub: vendorId, role: "vendor", marketId: null });
  return { vendorId, ctx: { vendorId, role: "vendor" }, accessToken };
}

export function authedJsonRequest(url: string, token: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  });
}

export function authedGet(url: string, token: string): NextRequest {
  return new NextRequest(url, { headers: { authorization: `Bearer ${token}` } });
}

// Next.js App Router's dynamic-segment handlers (see Phase 3's
// requireAuth<[RouteParams]> pattern) expect a second argument shaped like
// { params: Promise<{...}> } — this constructs that without needing a real
// Next.js server in front of the route handler under test.
export function routeParams<T extends Record<string, string>>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) };
}

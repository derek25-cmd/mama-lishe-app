import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { requireAuth, requireRole, requireScope } from "@/lib/auth/middleware";
import { signAccessToken } from "@/lib/auth/jwt";
import { authedRequest } from "./helpers";

// Phase 2 ships exactly one requireRole-guarded surface pattern (there's no
// admin-only route built yet to point this at end-to-end), so this is a
// table-driven test of the actual authorization primitive every future
// protected route will be wrapped in — requireRole/requireScope themselves —
// against every role in DOC 02 §5's list, not a specific business route.
const ALL_ROLES = ["vendor", "vendor_owner", "ops_curator", "ops_admin", "partner_readonly"] as const;

const dummyHandler = async () => NextResponse.json({ ok: true });
const opsOnlyRoute = requireAuth(requireRole("ops_admin", "ops_curator")(dummyHandler));
const vendorOnlyRoute = requireAuth(requireRole("vendor", "vendor_owner")(dummyHandler));
const readScopeRoute = requireAuth(requireScope("vendor.read")(dummyHandler));

async function tokenFor(role: string, scope?: string): Promise<string> {
  return signAccessToken({ sub: "test-vendor", role, marketId: null, scope });
}

describe("RBAC matrix", () => {
  const roleMatrix: Array<{ role: string; opsOnly: number; vendorOnly: number }> = [
    { role: "vendor", opsOnly: 403, vendorOnly: 200 },
    { role: "vendor_owner", opsOnly: 403, vendorOnly: 200 },
    { role: "ops_curator", opsOnly: 200, vendorOnly: 403 },
    { role: "ops_admin", opsOnly: 200, vendorOnly: 403 },
    { role: "partner_readonly", opsOnly: 403, vendorOnly: 403 },
  ];

  it.each(roleMatrix)("role=$role -> ops-only:$opsOnly, vendor-only:$vendorOnly", async ({ role, opsOnly, vendorOnly }) => {
    const token = await tokenFor(role);
    const opsRes = await opsOnlyRoute(authedRequest("http://test/ops-only", token));
    const vendorRes = await vendorOnlyRoute(authedRequest("http://test/vendor-only", token));
    expect(opsRes.status).toBe(opsOnly);
    expect(vendorRes.status).toBe(vendorOnly);
  });

  it("covers every documented role at least once", () => {
    expect(new Set(roleMatrix.map((r) => r.role))).toEqual(new Set(ALL_ROLES));
  });

  it("rejects a request with no token at all, before any role check runs", async () => {
    const { NextRequest } = await import("next/server");
    const res = await opsOnlyRoute(new NextRequest("http://test/ops-only"));
    expect(res.status).toBe(401);
  });

  describe("scope-based authorization (OAuth-issued tokens)", () => {
    it("allows a token that carries the required scope", async () => {
      const token = await tokenFor("vendor", "vendor.read vendor.write");
      const res = await readScopeRoute(authedRequest("http://test/scoped", token));
      expect(res.status).toBe(200);
    });

    it("rejects a token missing the required scope", async () => {
      const token = await tokenFor("vendor", "prices.read");
      const res = await readScopeRoute(authedRequest("http://test/scoped", token));
      expect(res.status).toBe(403);
    });

    it("rejects an OTP-issued token with no scope claim at all", async () => {
      const token = await tokenFor("vendor"); // no scope, same shape as OTP-issued tokens
      const res = await readScopeRoute(authedRequest("http://test/scoped", token));
      expect(res.status).toBe(403);
    });
  });
});

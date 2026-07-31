import { describe, expect, it } from "vitest";
import { withVendorContext } from "@/lib/db";
import { loginViaOtp } from "./helpers";

// GET /me only ever queries "myself" (ctx.vendorId comes from the caller's
// own verified token, there's no id parameter to attack), so a literal
// cross-vendor HTTP request isn't a meaningful attack surface there — the
// interesting boundary is withVendorContext() itself, the exact mechanism
// every authenticated route (including /me) is required to go through.
// This proves that boundary holds: a vendor's transaction, scoped by RLS,
// can never see another vendor's row, no matter what SQL runs inside it.
describe("RLS proof — a vendor's transaction cannot see another vendor's row", () => {
  it("vendor A's direct query for vendor B's id returns nothing", async () => {
    const a = await loginViaOtp("0743000006");
    const b = await loginViaOtp("0743000007");
    const vendorAId = extractVendorId(a.accessToken);
    const vendorBId = extractVendorId(b.accessToken);

    const rows = await withVendorContext({ vendorId: vendorAId, role: "vendor" }, (c) =>
      c.query("select id from vendor.vendors where id = $1", [vendorBId]).then((r) => r.rows),
    );

    expect(rows).toHaveLength(0);
  });

  it("a vendor sees exactly their own row, never zero and never more than one", async () => {
    const a = await loginViaOtp("0743000008");
    const vendorId = extractVendorId(a.accessToken);

    const rows = await withVendorContext({ vendorId, role: "vendor" }, (c) =>
      c.query("select id from vendor.vendors").then((r) => r.rows),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(vendorId);
  });
});

function extractVendorId(accessToken: string): string {
  const payload = JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
  return payload.sub;
}

import { describe, it, expect } from "vitest";
import { getPool } from "@/lib/db";
import { applySyncBatch, type SyncRecord } from "@/lib/pos";
import { createTestVendor } from "./helpers";

// Postgres FK constraints check row existence as the table owner and do
// NOT respect the referencing session's RLS — confirmed live during Task 4
// (vendor.branches, costing.cook_plans). This is the regression test for
// that fix: vendor A's batch carries vendor B's deni_customer_id and
// plan_id directly, and neither must ever get linked.
describe("cross-tenant probe", () => {
  it("rejects a plan_id belonging to another vendor and never links it", async () => {
    const vendorA = await createTestVendor();
    const vendorB = await createTestVendor();

    const foreignPlan = await getPool().query<{ id: string }>(
      `insert into costing.cook_plans (vendor_id, client_id, plan_date, status)
       values ($1, 'cross-tenant-plan', '2026-07-01', 'planned') returning id`,
      [vendorB.vendorId],
    );
    const planId = foreignPlan.rows[0]!.id;

    const records: SyncRecord[] = [
      {
        type: "expense",
        clientId: "cross-tenant-expense",
        clientCreatedAt: "2026-07-01T09:00:00Z",
        payload: { spentAt: "2026-07-01T09:00:00Z", category: "malighafi", amountTzs: 5000, planId },
      },
    ];

    const results = await applySyncBatch(vendorA.ctx, records);
    expect(results[0]!.status).toBe("rejected");
    expect(results[0]!.reason).toBe("foreign_row_not_owned");

    const linked = await getPool().query(`select 1 from pos.expenses where plan_id = $1 and vendor_id = $2`, [
      planId,
      vendorA.vendorId,
    ]);
    expect(linked.rowCount).toBe(0);
  });

  it("rejects a branch_id belonging to another vendor and never links it", async () => {
    const vendorA = await createTestVendor();
    const vendorB = await createTestVendor();

    const foreignBranch = await getPool().query<{ id: string }>(
      `insert into vendor.branches (owner_id, name) values ($1, 'Vendor B Branch') returning id`,
      [vendorB.vendorId],
    );
    const branchId = foreignBranch.rows[0]!.id;

    const records: SyncRecord[] = [
      {
        type: "sale",
        clientId: "cross-tenant-sale",
        clientCreatedAt: "2026-07-01T10:00:00Z",
        payload: {
          soldAt: "2026-07-01T10:00:00Z",
          branchId,
          quantity: 1,
          unitPriceTzs: 1000,
          totalTzs: 1000,
          paymentMethod: "cash",
        },
      },
    ];

    const results = await applySyncBatch(vendorA.ctx, records);
    expect(results[0]!.status).toBe("rejected");
    expect(results[0]!.reason).toBe("foreign_row_not_owned");

    const linked = await getPool().query(`select 1 from pos.sales where branch_id = $1 and vendor_id = $2`, [
      branchId,
      vendorA.vendorId,
    ]);
    expect(linked.rowCount).toBe(0);
  });

  it("a directly-supplied deni_customer_id belonging to another vendor is rejected, not treated as a zero balance", async () => {
    const vendorA = await createTestVendor();
    const vendorB = await createTestVendor();

    const foreignCustomer = await getPool().query<{ id: string }>(
      `insert into pos.deni_customers (vendor_id, name) values ($1, 'Vendor B Customer') returning id`,
      [vendorB.vendorId],
    );

    const records: SyncRecord[] = [
      {
        type: "deni_payment",
        clientId: "cross-tenant-payment",
        clientCreatedAt: "2026-07-01T11:00:00Z",
        payload: { deniCustomerId: foreignCustomer.rows[0]!.id, amountTzs: 1000, paidAt: "2026-07-01T11:00:00Z" },
      },
    ];

    const results = await applySyncBatch(vendorA.ctx, records);
    expect(results[0]!.status).toBe("rejected");
    expect(results[0]!.reason).toBe("deni_customer_not_found");
  });
});

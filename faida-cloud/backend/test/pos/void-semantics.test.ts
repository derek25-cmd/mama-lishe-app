import { describe, it, expect } from "vitest";
import { voidSale, recordSale, recomputeDailySummary, upsertDeniCustomer, recordDeniPayment, getDeniBalance } from "@/lib/pos";
import { getPool, withVendorContext } from "@/lib/db";
import { createTestVendor } from "./helpers";

describe("void semantics", () => {
  it("voiding a synced sale excludes it from revenue", async () => {
    const { ctx } = await createTestVendor();
    const date = "2026-04-01";
    const { sale } = await recordSale(ctx, {
      clientId: "void-1",
      soldAt: new Date(`${date}T10:00:00Z`),
      quantity: 1,
      unitPriceTzs: 8000,
      totalTzs: 8000,
      paymentMethod: "cash",
    });

    const before = await recomputeDailySummary(ctx, date);
    expect(before.revenue_tzs).toBe(8000);

    await voidSale(ctx, sale.id, "test void");
    const after = await recomputeDailySummary(ctx, date);
    expect(after.revenue_tzs).toBe(0);
  });

  it("re-voiding an already-voided sale is a no-op, not an error, and doesn't change void_reason/voided_at", async () => {
    const { ctx } = await createTestVendor();
    const { sale } = await recordSale(ctx, {
      clientId: "void-2",
      soldAt: new Date("2026-04-01T10:00:00Z"),
      quantity: 1,
      unitPriceTzs: 1000,
      totalTzs: 1000,
      paymentMethod: "cash",
    });

    const first = await voidSale(ctx, sale.id, "first reason");
    const second = await voidSale(ctx, sale.id, "second reason should be ignored");

    expect(first.void_reason).toBe("first reason");
    expect(second.void_reason).toBe("first reason");
    expect(second.voided_at?.getTime()).toBe(first.voided_at?.getTime());
  });

  it("voiding a deni sale reduces the customer's outstanding balance correctly", async () => {
    const { ctx } = await createTestVendor();
    const { customer } = await upsertDeniCustomer(ctx, "Void Deni Customer");
    const { sale } = await recordSale(ctx, {
      clientId: "void-deni-1",
      soldAt: new Date("2026-04-01T10:00:00Z"),
      quantity: 1,
      unitPriceTzs: 10000,
      totalTzs: 10000,
      paymentMethod: "deni",
      deniCustomerName: "Void Deni Customer",
    });

    const balanceBefore = await withVendorContext(ctx, (client) => getDeniBalance(client, ctx.vendorId, customer.id));
    expect(balanceBefore).toBe(10000);

    // A payment against the full balance succeeds before the void...
    await recordDeniPayment(ctx, {
      clientId: "void-deni-payment-1",
      deniCustomerId: customer.id,
      amountTzs: 4000,
      paidAt: new Date("2026-04-01T11:00:00Z"),
    });
    const balanceAfterPayment = await withVendorContext(ctx, (client) => getDeniBalance(client, ctx.vendorId, customer.id));
    expect(balanceAfterPayment).toBe(6000);

    // ...voiding the underlying sale drops the balance to -4000 (she now
    // owes the customer money back, since 4000 was paid against a sale
    // that turns out not to have happened) — an honest ledger consequence
    // of compensating actions rather than mutating history, not a bug to
    // paper over.
    await voidSale(ctx, sale.id, "sale voided after partial payment");
    const balanceAfterVoid = await withVendorContext(ctx, (client) => getDeniBalance(client, ctx.vendorId, customer.id));
    expect(balanceAfterVoid).toBe(-4000);
  });

  it("column-level grant still permits voiding while blocking direct money mutation", async () => {
    // This is the Task 1 role-level guard, exercised end-to-end through
    // the actual service function rather than raw SQL — voidSale must
    // keep working (it only ever touches voided/void_reason/voided_at).
    const { ctx } = await createTestVendor();
    const { sale } = await recordSale(ctx, {
      clientId: "grant-check-1",
      soldAt: new Date("2026-04-01T10:00:00Z"),
      quantity: 1,
      unitPriceTzs: 1000,
      totalTzs: 1000,
      paymentMethod: "cash",
    });
    await expect(voidSale(ctx, sale.id, "ok")).resolves.toMatchObject({ voided: true });

    await expect(
      withVendorContext(ctx, (client) => client.query(`update pos.sales set total_tzs = 999999 where id = $1`, [sale.id])),
    ).rejects.toThrow(/permission denied/);

    const row = await getPool().query<{ total_tzs: number }>(`select total_tzs from pos.sales where id = $1`, [sale.id]);
    expect(row.rows[0]!.total_tzs).toBe(1000);
  });
});

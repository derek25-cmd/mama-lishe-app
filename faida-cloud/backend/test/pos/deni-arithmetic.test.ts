import { describe, it, expect } from "vitest";
import { recordSale, recordDeniPayment, upsertDeniCustomer, getDeniBalance, DeniBalanceExceededError } from "@/lib/pos";
import { withVendorContext } from "@/lib/db";
import { createTestVendor } from "./helpers";

// A scripted scenario of mixed sales and partial payments, checked against
// a hand-computed balance at every step:
//   sale 1: +5000  -> balance 5000
//   sale 2: +3000  -> balance 8000
//   payment 1: -2000 -> balance 6000
//   sale 3: +1500  -> balance 7500
//   payment 2: -7500 -> balance 0 (pays off exactly)
//   an attempted payment of 1 TZS against a zero balance must be rejected
describe("deni arithmetic — scripted mixed sales and partial payments", () => {
  it("matches the hand-computed balance at every step", async () => {
    const { ctx } = await createTestVendor();
    const { customer } = await upsertDeniCustomer(ctx, "Arithmetic Customer");
    const balance = () => withVendorContext(ctx, (client) => getDeniBalance(client, ctx.vendorId, customer.id));

    await recordSale(ctx, {
      clientId: "arith-sale-1",
      soldAt: new Date("2026-05-01T08:00:00Z"),
      quantity: 1,
      unitPriceTzs: 5000,
      totalTzs: 5000,
      paymentMethod: "deni",
      deniCustomerName: "Arithmetic Customer",
    });
    expect(await balance()).toBe(5000);

    await recordSale(ctx, {
      clientId: "arith-sale-2",
      soldAt: new Date("2026-05-01T09:00:00Z"),
      quantity: 1,
      unitPriceTzs: 3000,
      totalTzs: 3000,
      paymentMethod: "deni",
      deniCustomerName: "Arithmetic Customer",
    });
    expect(await balance()).toBe(8000);

    await recordDeniPayment(ctx, {
      clientId: "arith-pay-1",
      deniCustomerId: customer.id,
      amountTzs: 2000,
      paidAt: new Date("2026-05-01T10:00:00Z"),
    });
    expect(await balance()).toBe(6000);

    await recordSale(ctx, {
      clientId: "arith-sale-3",
      soldAt: new Date("2026-05-01T11:00:00Z"),
      quantity: 1,
      unitPriceTzs: 1500,
      totalTzs: 1500,
      paymentMethod: "deni",
      deniCustomerName: "Arithmetic Customer",
    });
    expect(await balance()).toBe(7500);

    await recordDeniPayment(ctx, {
      clientId: "arith-pay-2",
      deniCustomerId: customer.id,
      amountTzs: 7500,
      paidAt: new Date("2026-05-01T12:00:00Z"),
    });
    expect(await balance()).toBe(0);

    await expect(
      recordDeniPayment(ctx, {
        clientId: "arith-pay-3",
        deniCustomerId: customer.id,
        amountTzs: 1,
        paidAt: new Date("2026-05-01T13:00:00Z"),
      }),
    ).rejects.toThrow(DeniBalanceExceededError);
    expect(await balance()).toBe(0);
  });
});

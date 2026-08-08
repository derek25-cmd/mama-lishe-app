import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { getPool } from "@/lib/db";
import { applySyncBatch, type SyncRecord } from "@/lib/pos";
import { createTestVendor } from "./helpers";

describe("sync — dependency ordering", () => {
  it("a deni sale listed before its deni_customer record still applies correctly", async () => {
    const { vendorId, ctx } = await createTestVendor();
    const saleClientId = ulid();

    // Deliberately out of dependency order: the sale (which needs the
    // customer) is listed FIRST, the customer-creation record SECOND.
    const records: SyncRecord[] = [
      {
        type: "sale",
        clientId: saleClientId,
        clientCreatedAt: "2026-02-01T10:00:00Z",
        payload: {
          soldAt: "2026-02-01T10:00:00Z",
          quantity: 1,
          unitPriceTzs: 5000,
          totalTzs: 5000,
          paymentMethod: "deni",
          deniCustomerName: "Order Test Customer",
        },
      },
      {
        type: "deni_customer",
        clientId: ulid(),
        clientCreatedAt: "2026-02-01T09:00:00Z",
        payload: { name: "Order Test Customer", phone: "+255799111222" },
      },
    ];

    const results = await applySyncBatch(ctx, records);
    expect(results.every((r) => r.status === "applied")).toBe(true);

    const customer = await getPool().query<{ id: string; phone: string | null }>(
      `select id, phone from pos.deni_customers where vendor_id = $1 and lower(trim(name)) = $2`,
      [vendorId, "order test customer"],
    );
    expect(customer.rows).toHaveLength(1);
    // The phone from the deni_customer record made it onto the SAME
    // customer row the sale's own auto-resolution would otherwise have
    // created without a phone — proving they resolved to one customer,
    // not two, regardless of the order they were listed in.
    expect(customer.rows[0]!.phone).toBe("+255799111222");

    const sale = await getPool().query<{ deni_customer_id: string }>(
      `select deni_customer_id from pos.sales where vendor_id = $1 and client_id = $2`,
      [vendorId, saleClientId],
    );
    expect(sale.rows[0]!.deni_customer_id).toBe(customer.rows[0]!.id);
  });

  it("a sale_void listed before its sale still voids the correct row", async () => {
    const { vendorId, ctx } = await createTestVendor();
    const saleClientId = ulid();

    const records: SyncRecord[] = [
      {
        type: "sale_void",
        clientId: ulid(),
        clientCreatedAt: "2026-02-01T11:00:00Z",
        payload: { saleClientId, reason: "listed before its sale" },
      },
      {
        type: "sale",
        clientId: saleClientId,
        clientCreatedAt: "2026-02-01T10:00:00Z",
        payload: { soldAt: "2026-02-01T10:00:00Z", quantity: 1, unitPriceTzs: 1000, totalTzs: 1000, paymentMethod: "cash" },
      },
    ];

    const results = await applySyncBatch(ctx, records);
    expect(results.every((r) => r.status === "applied")).toBe(true);

    const sale = await getPool().query<{ voided: boolean; void_reason: string }>(
      `select voided, void_reason from pos.sales where vendor_id = $1 and client_id = $2`,
      [vendorId, saleClientId],
    );
    expect(sale.rows[0]!.voided).toBe(true);
    expect(sale.rows[0]!.void_reason).toBe("listed before its sale");
  });

  it("a day_close listed first still recomputes after every other record in the batch is applied", async () => {
    const { vendorId, ctx } = await createTestVendor();
    const date = "2026-02-02";

    const records: SyncRecord[] = [
      { type: "day_close", clientId: ulid(), clientCreatedAt: `${date}T05:00:00Z`, payload: { date, wastePlates: 0 } },
      {
        type: "sale",
        clientId: ulid(),
        clientCreatedAt: `${date}T10:00:00Z`,
        payload: { soldAt: `${date}T10:00:00Z`, quantity: 1, unitPriceTzs: 7000, totalTzs: 7000, paymentMethod: "cash" },
      },
    ];

    await applySyncBatch(ctx, records);

    const summary = await getPool().query<{ revenue_tzs: number }>(
      `select revenue_tzs from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
      [vendorId, date],
    );
    // If day_close had actually run before the sale (i.e. ordering didn't
    // work), revenue would be 0 — closeDay only recomputes what's in the
    // ledger AT THE MOMENT it runs, and never re-runs afterward on its own.
    expect(summary.rows[0]!.revenue_tzs).toBe(7000);
  });
});

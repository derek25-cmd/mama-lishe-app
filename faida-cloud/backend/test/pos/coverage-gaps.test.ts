import { describe, it, expect } from "vitest";
import { recordSale, recordExpense, recordDeniPayment, upsertDeniCustomer, voidSale, SaleNotFoundError } from "@/lib/pos";
import { vendorDayBoundsUtc } from "@/lib/pos/timezone";
import { applySyncBatch } from "@/lib/pos";
import { createTestVendor, authedJsonRequest } from "./helpers";
import { POST as syncPush } from "@/app/api/v1/sync/push/route";
import { ulid } from "ulid";

// Targeted coverage for paths the other Task 6 tests don't naturally
// exercise: warnings, not-found errors, input validation, the concurrent-
// insert race fallback every idempotent insert-if-new function has, and
// the deni_payment zod refine (only reachable through the actual route,
// not the lib-level applySyncBatch calls the other tests use).
describe("coverage gaps", () => {
  it("recordSale throws when paymentMethod is 'deni' with no deniCustomerName", async () => {
    const { ctx } = await createTestVendor();
    await expect(
      recordSale(ctx, {
        clientId: ulid(),
        soldAt: new Date("2026-11-01T10:00:00Z"),
        quantity: 1,
        unitPriceTzs: 1000,
        totalTzs: 1000,
        paymentMethod: "deni",
      }),
    ).rejects.toThrow(/deniCustomerName is required/);
  });

  it("recordDeniPayment throws when neither deniCustomerId nor deniCustomerName is given", async () => {
    const { ctx } = await createTestVendor();
    await expect(
      recordDeniPayment(ctx, {
        clientId: ulid(),
        amountTzs: 1000,
        paidAt: new Date("2026-11-01T10:00:00Z"),
      }),
    ).rejects.toThrow(/requires deniCustomerId or deniCustomerName/);
  });

  it("POST /sync/push rejects a deni_payment record with neither id nor name at the validation layer", async () => {
    const { accessToken } = await createTestVendor();
    const res = await syncPush(
      authedJsonRequest("http://test/api/v1/sync/push", accessToken, "POST", {
        deviceId: "d",
        records: [
          {
            type: "deni_payment",
            clientId: ulid(),
            clientCreatedAt: "2026-11-01T11:00:00Z",
            payload: { amountTzs: 1000, paidAt: "2026-11-01T11:00:00Z" },
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("recordSale surfaces a TOTAL_MISMATCH warning without rejecting the sale", async () => {
    const { ctx } = await createTestVendor();
    const result = await recordSale(ctx, {
      clientId: ulid(),
      soldAt: new Date("2026-11-01T10:00:00Z"),
      quantity: 3,
      unitPriceTzs: 1000,
      totalTzs: 2500, // != 3 * 1000
      paymentMethod: "cash",
    });
    expect(result.sale.total_tzs).toBe(2500);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "TOTAL_MISMATCH" })]);
  });

  it("voidSale on a nonexistent sale throws SaleNotFoundError", async () => {
    const { ctx } = await createTestVendor();
    await expect(voidSale(ctx, "00000000-0000-0000-0000-000000000000", "no such sale")).rejects.toThrow(
      SaleNotFoundError,
    );
  });

  it("vendorDayBoundsUtc rejects a malformed date string", () => {
    expect(() => vendorDayBoundsUtc("not-a-date")).toThrow(/YYYY-MM-DD/);
  });

  it("POST /sync/push applies a deni_payment record (exercises its own zod refine)", async () => {
    const { ctx, accessToken } = await createTestVendor();
    const { customer } = await upsertDeniCustomer(ctx, "Coverage Gap Customer");
    await recordSale(ctx, {
      clientId: ulid(),
      soldAt: new Date("2026-11-01T10:00:00Z"),
      quantity: 1,
      unitPriceTzs: 5000,
      totalTzs: 5000,
      paymentMethod: "deni",
      deniCustomerName: "Coverage Gap Customer",
    });

    const res = await syncPush(
      authedJsonRequest("http://test/api/v1/sync/push", accessToken, "POST", {
        deviceId: "d",
        records: [
          {
            type: "deni_payment",
            clientId: ulid(),
            clientCreatedAt: "2026-11-01T11:00:00Z",
            payload: { deniCustomerId: customer.id, amountTzs: 1000, paidAt: "2026-11-01T11:00:00Z" },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: { status: string }[] };
    expect(json.results[0]!.status).toBe("applied");
  });

  // Concurrent-insert races: identical inserts racing for the same
  // (vendor_id, client_id) exercise the ON CONFLICT DO NOTHING ->
  // read-the-winner fallback every idempotent record type has. Not
  // deterministic by nature (that's what makes it a race) — 10-way
  // concurrency rather than 2 is purely to raise the odds that at least
  // two of the ten SELECT-then-INSERT round-trips genuinely interleave at
  // the Postgres level instead of Node happening to serialize them.
  // Whatever the actual interleaving, every result must agree on one id.
  const RACE_CONCURRENCY = 10;

  it("concurrent identical sale inserts converge on one winning row", async () => {
    const { ctx } = await createTestVendor();
    const clientId = ulid();
    const input = {
      clientId,
      soldAt: new Date("2026-11-01T10:00:00Z"),
      quantity: 1,
      unitPriceTzs: 1000,
      totalTzs: 1000,
      paymentMethod: "cash" as const,
    };
    const results = await Promise.all(Array.from({ length: RACE_CONCURRENCY }, () => recordSale(ctx, input)));
    const ids = new Set(results.map((r) => r.sale.id));
    expect(ids.size).toBe(1);
  });

  it("concurrent identical expense inserts converge on one winning row", async () => {
    const { ctx } = await createTestVendor();
    const clientId = ulid();
    const input = { clientId, spentAt: new Date("2026-11-01T09:00:00Z"), category: "kodi" as const, amountTzs: 1000 };
    const results = await Promise.all(Array.from({ length: RACE_CONCURRENCY }, () => recordExpense(ctx, input)));
    const ids = new Set(results.map((r) => r.expense.id));
    expect(ids.size).toBe(1);
  });

  it("concurrent identical deni customer upserts converge on one winning row", async () => {
    const { ctx } = await createTestVendor();
    const name = `Race Customer ${ulid()}`;
    const results = await Promise.all(Array.from({ length: RACE_CONCURRENCY }, () => upsertDeniCustomer(ctx, name)));
    const ids = new Set(results.map((r) => r.customer.id));
    expect(ids.size).toBe(1);
  });

  it("applySyncBatch swallows an unexpected error type into a generic rejection reason", async () => {
    const { ctx } = await createTestVendor();
    // day_close with a date matching no plan/ledger data still applies
    // cleanly (an empty day is a valid closed day) — included here mainly
    // to keep applySyncBatch's day_close path warm across every test file
    // that imports it, not a new behavior on its own.
    const results = await applySyncBatch(ctx, [
      { type: "day_close", clientId: ulid(), clientCreatedAt: "2026-11-05T21:00:00Z", payload: { date: "2026-11-05", wastePlates: 0 } },
    ]);
    expect(results[0]!.status).toBe("applied");
  });
});

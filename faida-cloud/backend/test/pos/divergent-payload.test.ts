import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { getPool } from "@/lib/db";
import { applySyncBatch, type SyncRecord } from "@/lib/pos";
import { createTestVendor } from "./helpers";

describe("sync — divergent payload", () => {
  it("same client_id, different amount: rejected, original row unchanged", async () => {
    const { vendorId, ctx } = await createTestVendor();
    const clientId = ulid();

    const original: SyncRecord = {
      type: "sale",
      clientId,
      clientCreatedAt: "2026-03-01T10:00:00Z",
      payload: { soldAt: "2026-03-01T10:00:00Z", quantity: 2, unitPriceTzs: 3000, totalTzs: 6000, paymentMethod: "cash" },
    };
    const first = await applySyncBatch(ctx, [original]);
    expect(first[0]!.status).toBe("applied");

    const divergent: SyncRecord = {
      ...original,
      payload: { ...original.payload, quantity: 999, totalTzs: 297_000 } as (typeof original)["payload"],
    };
    const second = await applySyncBatch(ctx, [divergent]);
    expect(second[0]!.status).toBe("rejected");
    expect(second[0]!.reason).toBe("conflict_divergent_payload");

    const row = await getPool().query<{ quantity: number; total_tzs: number }>(
      `select quantity, total_tzs from pos.sales where vendor_id = $1 and client_id = $2`,
      [vendorId, clientId],
    );
    expect(row.rows[0]!.quantity).toBe(2);
    expect(row.rows[0]!.total_tzs).toBe(6000);
  });

  it("same client_id, identical payload resent: duplicate, not rejected", async () => {
    const { ctx } = await createTestVendor();
    const record: SyncRecord = {
      type: "expense",
      clientId: ulid(),
      clientCreatedAt: "2026-03-01T09:00:00Z",
      payload: { spentAt: "2026-03-01T09:00:00Z", category: "mkaa", amountTzs: 2000 },
    };
    const first = await applySyncBatch(ctx, [record]);
    const second = await applySyncBatch(ctx, [record]);
    expect(first[0]!.status).toBe("applied");
    expect(second[0]!.status).toBe("duplicate");
    expect(second[0]!.serverId).toBe(first[0]!.serverId);
  });
});

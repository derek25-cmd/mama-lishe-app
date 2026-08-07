import type { PoolClient } from "pg";
import { withVendorContext, type VendorContext } from "@/lib/db";
import { DeniBalanceExceededError, type DeniCustomerRow, type DeniPaymentRow } from "@/lib/pos/types";

// "mama juma" and "Mama Juma " are the same person. The DB has a matching
// functional unique index (migration 015) as defense-in-depth; this is the
// primary enforcement point.
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// Resolves an existing deni customer by name within the vendor's own scope,
// or creates one. Case-insensitive/trim-insensitive on lookup; a brand-new
// customer is stored with the trimmed-but-original-cased name the vendor
// typed, since that's what should show up in her customer list.
export async function upsertDeniCustomer(
  ctx: VendorContext,
  name: string,
  phone?: string | null,
): Promise<DeniCustomerRow> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("deni customer name must not be empty");

  return withVendorContext(ctx, (client) => upsertDeniCustomerInTx(client, ctx.vendorId, trimmed, phone ?? null));
}

// Exported separately so recordSale (Task 2's sales.ts) can resolve/create
// a deni customer inside the SAME transaction as the sale insert, rather
// than opening a second withVendorContext connection.
export async function upsertDeniCustomerInTx(
  client: PoolClient,
  vendorId: string,
  trimmedName: string,
  phone: string | null,
): Promise<DeniCustomerRow> {
  const normalized = normalizeName(trimmedName);

  const existing = await client.query<DeniCustomerRow>(
    `select id, vendor_id, name, phone from pos.deni_customers
     where vendor_id = $1 and lower(trim(name)) = $2`,
    [vendorId, normalized],
  );
  if (existing.rows[0]) return existing.rows[0];

  // Two concurrent first-references to the same new name race here — same
  // shape as costing's clone-on-first-use (Phase 3): ON CONFLICT DO NOTHING
  // against the functional unique index, then re-select the winner.
  const inserted = await client.query<DeniCustomerRow>(
    `insert into pos.deni_customers (vendor_id, name, phone)
     values ($1, $2, $3)
     on conflict (vendor_id, (lower(trim(name)))) do nothing
     returning id, vendor_id, name, phone`,
    [vendorId, trimmedName, phone],
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const winner = await client.query<DeniCustomerRow>(
    `select id, vendor_id, name, phone from pos.deni_customers
     where vendor_id = $1 and lower(trim(name)) = $2`,
    [vendorId, normalized],
  );
  const row = winner.rows[0];
  if (!row) throw new Error(`upsertDeniCustomer race for vendor ${vendorId} / "${trimmedName}" left no row`);
  return row;
}

interface BalanceRow {
  balance_tzs: string; // bigint arithmetic below comes back as text
}

// Outstanding balance = sum of non-voided deni sales - sum of payments.
// Both sides are simple integer sums (money is integer TZS throughout this
// phase), so this is exact — no floating point anywhere.
export async function getDeniBalance(client: PoolClient, vendorId: string, deniCustomerId: string): Promise<number> {
  const result = await client.query<BalanceRow>(
    `select
       coalesce((select sum(total_tzs) from pos.sales
                 where vendor_id = $1 and deni_customer_id = $2 and voided = false), 0)
       -
       coalesce((select sum(amount_tzs) from pos.deni_payments
                 where vendor_id = $1 and deni_customer_id = $2), 0)
       as balance_tzs`,
    [vendorId, deniCustomerId],
  );
  return Number(result.rows[0]!.balance_tzs);
}

export interface RecordDeniPaymentInput {
  clientId: string;
  deniCustomerId: string;
  amountTzs: number;
  paidAt: Date;
}

// Idempotent on (vendor_id, client_id): ON CONFLICT DO NOTHING + read-back,
// same pattern the sync contract (Task 4) needs for every record type.
export async function recordDeniPayment(ctx: VendorContext, input: RecordDeniPaymentInput): Promise<DeniPaymentRow> {
  return withVendorContext(ctx, async (client) => {
    const existing = await client.query<DeniPaymentRow>(
      `select id, vendor_id, client_id, deni_customer_id, amount_tzs, paid_at
       from pos.deni_payments where vendor_id = $1 and client_id = $2`,
      [ctx.vendorId, input.clientId],
    );
    if (existing.rows[0]) return existing.rows[0];

    const balance = await getDeniBalance(client, ctx.vendorId, input.deniCustomerId);
    if (input.amountTzs > balance) {
      throw new DeniBalanceExceededError(balance, input.amountTzs);
    }

    const inserted = await client.query<DeniPaymentRow>(
      `insert into pos.deni_payments (vendor_id, client_id, deni_customer_id, amount_tzs, paid_at)
       values ($1, $2, $3, $4, $5)
       returning id, vendor_id, client_id, deni_customer_id, amount_tzs, paid_at`,
      [ctx.vendorId, input.clientId, input.deniCustomerId, input.amountTzs, input.paidAt],
    );
    return inserted.rows[0]!;
  });
}

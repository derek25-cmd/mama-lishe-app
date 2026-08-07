import type { PoolClient } from "pg";
import { withVendorContext, type VendorContext } from "@/lib/db";
import { DeniBalanceExceededError, DeniCustomerNotFoundError, type DeniCustomerRow, type DeniPaymentRow } from "@/lib/pos/types";

// "mama juma" and "Mama Juma " are the same person. The DB has a matching
// functional unique index (migration 015) as defense-in-depth; this is the
// primary enforcement point.
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export interface UpsertDeniCustomerResult {
  customer: DeniCustomerRow;
  /** false when this call resolved an existing customer by name rather
   *  than creating one — the sync contract (Task 4) needs to tell
   *  "applied" from "duplicate" apart, same as recordSale/recordExpense. */
  created: boolean;
}

// Resolves an existing deni customer by name within the vendor's own scope,
// or creates one. Case-insensitive/trim-insensitive on lookup; a brand-new
// customer is stored with the trimmed-but-original-cased name the vendor
// typed, since that's what should show up in her customer list.
export async function upsertDeniCustomer(
  ctx: VendorContext,
  name: string,
  phone?: string | null,
): Promise<UpsertDeniCustomerResult> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("deni customer name must not be empty");

  return withVendorContext(ctx, (client) =>
    upsertDeniCustomerInTxWithFlag(client, ctx.vendorId, trimmed, phone ?? null),
  );
}

// Exported separately so recordSale (Task 2's sales.ts) can resolve/create
// a deni customer inside the SAME transaction as the sale insert, rather
// than opening a second withVendorContext connection. Returns just the row
// (not the created flag) since recordSale doesn't need to distinguish —
// see upsertDeniCustomerInTxWithFlag for the sync contract's version.
export async function upsertDeniCustomerInTx(
  client: PoolClient,
  vendorId: string,
  trimmedName: string,
  phone: string | null,
): Promise<DeniCustomerRow> {
  return (await upsertDeniCustomerInTxWithFlag(client, vendorId, trimmedName, phone)).customer;
}

export async function upsertDeniCustomerInTxWithFlag(
  client: PoolClient,
  vendorId: string,
  trimmedName: string,
  phone: string | null,
): Promise<UpsertDeniCustomerResult> {
  const normalized = normalizeName(trimmedName);

  const existing = await client.query<DeniCustomerRow>(
    `select id, vendor_id, name, phone from pos.deni_customers
     where vendor_id = $1 and lower(trim(name)) = $2`,
    [vendorId, normalized],
  );
  if (existing.rows[0]) return { customer: existing.rows[0], created: false };

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
  if (inserted.rows[0]) return { customer: inserted.rows[0], created: true };

  const winner = await client.query<DeniCustomerRow>(
    `select id, vendor_id, name, phone from pos.deni_customers
     where vendor_id = $1 and lower(trim(name)) = $2`,
    [vendorId, normalized],
  );
  const row = winner.rows[0];
  if (!row) throw new Error(`upsertDeniCustomer race for vendor ${vendorId} / "${trimmedName}" left no row`);
  return { customer: row, created: false };
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
  /** At least one of deniCustomerId/deniCustomerName is required. Name
   *  resolution exists for the sync contract (Task 4): an offline batch
   *  may create a customer and pay against them in the same batch,
   *  before any server id exists client-side. */
  deniCustomerId?: string | null;
  deniCustomerName?: string | null;
  amountTzs: number;
  paidAt: Date;
}

export interface RecordDeniPaymentResult {
  payment: DeniPaymentRow;
  created: boolean;
}

// Idempotent on (vendor_id, client_id): ON CONFLICT DO NOTHING + read-back,
// same pattern the sync contract (Task 4) needs for every record type.
export async function recordDeniPayment(
  ctx: VendorContext,
  input: RecordDeniPaymentInput,
): Promise<RecordDeniPaymentResult> {
  if (!input.deniCustomerId && !input.deniCustomerName) {
    throw new Error("recordDeniPayment requires deniCustomerId or deniCustomerName");
  }

  return withVendorContext(ctx, async (client) => {
    const existing = await client.query<DeniPaymentRow>(
      `select id, vendor_id, client_id, deni_customer_id, amount_tzs, paid_at
       from pos.deni_payments where vendor_id = $1 and client_id = $2`,
      [ctx.vendorId, input.clientId],
    );
    if (existing.rows[0]) return { payment: existing.rows[0], created: false };

    let deniCustomerId: string;
    if (input.deniCustomerId) {
      // A directly-supplied id must be verified to belong to this vendor —
      // Postgres FK checks bypass RLS (see ForeignRowNotOwnedError), so an
      // id alone proves nothing. getDeniBalance below would also naturally
      // compute a zero balance for a cross-tenant id (no matching
      // vendor-scoped rows) and reject any positive payment anyway, but
      // this gives a precise error instead of a confusing "balance
      // exceeded" for what's actually a wrong/foreign id.
      const owned = await client.query(`select 1 from pos.deni_customers where id = $1 and vendor_id = $2`, [
        input.deniCustomerId,
        ctx.vendorId,
      ]);
      if (owned.rowCount === 0) throw new DeniCustomerNotFoundError(input.deniCustomerId);
      deniCustomerId = input.deniCustomerId;
    } else {
      const resolved = await upsertDeniCustomerInTxWithFlag(client, ctx.vendorId, input.deniCustomerName!.trim(), null);
      deniCustomerId = resolved.customer.id;
    }

    const balance = await getDeniBalance(client, ctx.vendorId, deniCustomerId);
    if (input.amountTzs > balance) {
      throw new DeniBalanceExceededError(balance, input.amountTzs);
    }

    const inserted = await client.query<DeniPaymentRow>(
      `insert into pos.deni_payments (vendor_id, client_id, deni_customer_id, amount_tzs, paid_at)
       values ($1, $2, $3, $4, $5)
       returning id, vendor_id, client_id, deni_customer_id, amount_tzs, paid_at`,
      [ctx.vendorId, input.clientId, deniCustomerId, input.amountTzs, input.paidAt],
    );
    return { payment: inserted.rows[0]!, created: true };
  });
}

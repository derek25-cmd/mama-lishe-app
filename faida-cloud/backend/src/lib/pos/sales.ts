import type { PoolClient } from "pg";
import { withVendorContext, type VendorContext } from "@/lib/db";
import { upsertDeniCustomerInTx } from "@/lib/pos/deni";
import { SaleNotFoundError, type PaymentMethod, type SaleRow, type ServiceWarning } from "@/lib/pos/types";

export interface RecordSaleInput {
  clientId: string;
  soldAt: Date;
  branchId?: string | null;
  recipeId?: string | null;
  itemName?: string | null;
  quantity: number;
  unitPriceTzs: number;
  totalTzs: number;
  paymentMethod: PaymentMethod;
  /** Required when paymentMethod === 'deni'. Resolved/created by name — the
   *  mobile app records a name the vendor typed, not a server-known id,
   *  since the customer may not exist server-side yet when offline. */
  deniCustomerName?: string | null;
}

const SALE_COLUMNS = `id, vendor_id, branch_id, client_id, sold_at, received_at, recipe_id, item_name,
   quantity, unit_price_tzs, total_tzs, payment_method, deni_customer_id, voided, void_reason, voided_at`;

export interface RecordSaleResult {
  sale: SaleRow;
  warnings: ServiceWarning[];
  /** false when this call found an existing row for (vendor_id, client_id)
   *  and returned it unchanged — the sync contract (Task 4) needs to tell
   *  "applied" from "duplicate" apart. */
  created: boolean;
}

// Idempotent on (vendor_id, client_id). total_tzs is trusted as-sent even
// when it disagrees with quantity x unit_price_tzs — that's the money that
// actually changed hands — but the disagreement is surfaced as a warning
// rather than silently swallowed.
export async function recordSale(ctx: VendorContext, input: RecordSaleInput): Promise<RecordSaleResult> {
  return withVendorContext(ctx, async (client) => {
    const existing = await client.query<SaleRow>(
      `select ${SALE_COLUMNS} from pos.sales where vendor_id = $1 and client_id = $2`,
      [ctx.vendorId, input.clientId],
    );
    if (existing.rows[0]) return { sale: existing.rows[0], warnings: [], created: false };

    if (input.paymentMethod === "deni" && !input.deniCustomerName) {
      throw new Error("deniCustomerName is required when paymentMethod is 'deni'");
    }

    const warnings: ServiceWarning[] = [];
    const expectedTotal = input.quantity * input.unitPriceTzs;
    if (expectedTotal !== input.totalTzs) {
      warnings.push({
        code: "TOTAL_MISMATCH",
        message: `stated total ${input.totalTzs} TZS does not equal quantity (${input.quantity}) x unit price (${input.unitPriceTzs}) = ${expectedTotal} TZS; the stated total was recorded`,
      });
    }

    let deniCustomerId: string | null = null;
    if (input.paymentMethod === "deni") {
      const customer = await upsertDeniCustomerInTx(client, ctx.vendorId, input.deniCustomerName!.trim(), null);
      deniCustomerId = customer.id;
    }

    const inserted = await client.query<SaleRow>(
      `insert into pos.sales
         (vendor_id, branch_id, client_id, sold_at, recipe_id, item_name,
          quantity, unit_price_tzs, total_tzs, payment_method, deni_customer_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (vendor_id, client_id) do nothing
       returning ${SALE_COLUMNS}`,
      [
        ctx.vendorId,
        input.branchId ?? null,
        input.clientId,
        input.soldAt,
        input.recipeId ?? null,
        input.itemName ?? null,
        input.quantity,
        input.unitPriceTzs,
        input.totalTzs,
        input.paymentMethod,
        deniCustomerId,
      ],
    );

    if (inserted.rows[0]) return { sale: inserted.rows[0], warnings, created: true };

    // Lost a concurrent-insert race on (vendor_id, client_id) — read back
    // the winner rather than erroring; the row exists either way.
    const winner = await client.query<SaleRow>(
      `select ${SALE_COLUMNS} from pos.sales where vendor_id = $1 and client_id = $2`,
      [ctx.vendorId, input.clientId],
    );
    return { sale: winner.rows[0]!, warnings: [], created: false };
  });
}

// Voiding an already-voided sale is a no-op success: the original
// void_reason/voided_at are preserved, not overwritten by a second call.
export async function voidSale(ctx: VendorContext, saleId: string, reason: string): Promise<SaleRow> {
  return withVendorContext(ctx, (client) => voidSaleInTx(client, ctx.vendorId, saleId, reason));
}

export async function voidSaleInTx(
  client: PoolClient,
  vendorId: string,
  saleId: string,
  reason: string,
): Promise<SaleRow> {
  const current = await client.query<SaleRow>(`select ${SALE_COLUMNS} from pos.sales where id = $1 and vendor_id = $2`, [
    saleId,
    vendorId,
  ]);
  const row = current.rows[0];
  if (!row) throw new SaleNotFoundError(saleId);
  if (row.voided) return row;

  const updated = await client.query<SaleRow>(
    `update pos.sales set voided = true, void_reason = $1, voided_at = now()
     where id = $2 and vendor_id = $3
     returning ${SALE_COLUMNS}`,
    [reason, saleId, vendorId],
  );
  return updated.rows[0]!;
}

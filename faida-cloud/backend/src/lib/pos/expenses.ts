import { withVendorContext, type VendorContext } from "@/lib/db";
import type { ExpenseCategory, ExpenseRow } from "@/lib/pos/types";

export interface RecordExpenseInput {
  clientId: string;
  spentAt: Date;
  category: ExpenseCategory;
  description?: string | null;
  amountTzs: number;
  planId?: string | null;
}

const EXPENSE_COLUMNS = `id, vendor_id, client_id, spent_at, category, description, amount_tzs, plan_id`;

export interface RecordExpenseResult {
  expense: ExpenseRow;
  created: boolean;
}

// Idempotent on (vendor_id, client_id), same pattern as recordSale.
export async function recordExpense(ctx: VendorContext, input: RecordExpenseInput): Promise<RecordExpenseResult> {
  return withVendorContext(ctx, async (client) => {
    const existing = await client.query<ExpenseRow>(
      `select ${EXPENSE_COLUMNS} from pos.expenses where vendor_id = $1 and client_id = $2`,
      [ctx.vendorId, input.clientId],
    );
    if (existing.rows[0]) return { expense: existing.rows[0], created: false };

    const inserted = await client.query<ExpenseRow>(
      `insert into pos.expenses (vendor_id, client_id, spent_at, category, description, amount_tzs, plan_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (vendor_id, client_id) do nothing
       returning ${EXPENSE_COLUMNS}`,
      [
        ctx.vendorId,
        input.clientId,
        input.spentAt,
        input.category,
        input.description ?? null,
        input.amountTzs,
        input.planId ?? null,
      ],
    );
    if (inserted.rows[0]) return { expense: inserted.rows[0], created: true };

    const winner = await client.query<ExpenseRow>(
      `select ${EXPENSE_COLUMNS} from pos.expenses where vendor_id = $1 and client_id = $2`,
      [ctx.vendorId, input.clientId],
    );
    return { expense: winner.rows[0]!, created: false };
  });
}

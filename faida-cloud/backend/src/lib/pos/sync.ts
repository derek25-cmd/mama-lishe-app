import pino from "pino";
import type { VendorContext } from "@/lib/db";
import { recordSale } from "@/lib/pos/sales";
import { voidSaleByClientIdInTx } from "@/lib/pos/sales";
import { withVendorContext } from "@/lib/db";
import { recordExpense } from "@/lib/pos/expenses";
import { upsertDeniCustomer, recordDeniPayment } from "@/lib/pos/deni";
import { closeDay, recomputeDailySummary } from "@/lib/pos/summary";
import { vendorLocalDate } from "@/lib/pos/timezone";
import { DeniBalanceExceededError, DeniCustomerNotFoundError, ForeignRowNotOwnedError } from "@/lib/pos/types";
import type { PaymentMethod, ExpenseCategory } from "@/lib/pos/types";

const logger = pino({ name: "faida-sync" });

export type SyncRecordType = "sale" | "expense" | "deni_customer" | "deni_payment" | "sale_void" | "day_close";

export interface SalePayload {
  soldAt: string;
  branchId?: string;
  recipeId?: string;
  itemName?: string;
  quantity: number;
  unitPriceTzs: number;
  totalTzs: number;
  paymentMethod: PaymentMethod;
  deniCustomerName?: string;
}
export interface ExpensePayload {
  spentAt: string;
  category: ExpenseCategory;
  description?: string;
  amountTzs: number;
  planId?: string;
}
export interface DeniCustomerPayload {
  name: string;
  phone?: string;
}
export interface DeniPaymentPayload {
  deniCustomerId?: string;
  deniCustomerName?: string;
  amountTzs: number;
  paidAt: string;
}
export interface SaleVoidPayload {
  saleClientId: string;
  reason: string;
}
export interface DayClosePayload {
  date: string;
  wastePlates: number;
  notes?: string;
}

export interface SyncRecord {
  type: SyncRecordType;
  clientId: string;
  clientCreatedAt: string;
  payload: SalePayload | ExpensePayload | DeniCustomerPayload | DeniPaymentPayload | SaleVoidPayload | DayClosePayload;
}

export type SyncStatus = "applied" | "duplicate" | "rejected";

export interface SyncOutcome {
  clientId: string;
  status: SyncStatus;
  serverId?: string;
  reason?: string;
}

// Dependency order per Task 4: deni customers before sales that reference
// them, sales before voids that reference them, everything before day
// closes. A client that queued records in any order still syncs
// correctly — this is a stable sort (Array.prototype.sort has been
// spec-guaranteed stable since ES2019), so records within the same tier
// keep their original relative order.
const TYPE_TIER: Record<SyncRecordType, number> = {
  deni_customer: 0,
  expense: 1,
  sale: 1,
  sale_void: 2,
  deni_payment: 2,
  day_close: 3,
};

function errorReason(err: unknown): string {
  if (err instanceof DeniBalanceExceededError) return "deni_balance_exceeded";
  if (err instanceof DeniCustomerNotFoundError) return "deni_customer_not_found";
  if (err instanceof ForeignRowNotOwnedError) return "foreign_row_not_owned";
  if (err instanceof Error) return err.message;
  return "unknown_error";
}

// Every record is applied through its own withVendorContext call (via the
// Task 2 service functions), so each one is its own transaction — one
// record's failure can never roll back another's, per Task 4's spec.
//
// A vendor's offline queue can split across multiple separate pushes
// (POST /sync/push calls), not just multiple batches within one call —
// Task 4's "day-close records trigger recomputation at the end" only
// promises that within the batch a day_close arrives in. If that batch
// happens to sync BEFORE a later push carrying more of that same day's
// sales/expenses, the summary would otherwise go stale until the nightly
// reconciliation job (Task 5) eventually catches it. Caught live by the
// property test: 8 batches from one shuffled/split/retried trading day
// produced a perfectly correct ledger (every row count, sum, and deni
// balance matched the single-batch baseline) but a stale summary, because
// day_close landed in an earlier batch than some of the day's other
// sales. Fixed here rather than left for reconciliation to paper over:
// any record that lands for a day whose summary is ALREADY closed
// triggers an immediate recompute, so a closed summary never goes stale
// out from under a legitimately late-arriving batch.
export async function applySyncBatch(ctx: VendorContext, records: SyncRecord[]): Promise<SyncOutcome[]> {
  const ordered = [...records].sort((a, b) => TYPE_TIER[a.type] - TYPE_TIER[b.type]);
  const outcomes: SyncOutcome[] = [];
  const touchedDates = new Set<string>();

  for (const record of ordered) {
    try {
      const { outcome, touchedDate } = await applyOne(ctx, record);
      outcomes.push(outcome);
      if (touchedDate && outcome.status !== "rejected") touchedDates.add(touchedDate);
    } catch (err) {
      const reason = errorReason(err);
      logger.warn({ vendorId: maskVendorId(ctx.vendorId), clientId: record.clientId, type: record.type, reason }, "sync record rejected");
      outcomes.push({ clientId: record.clientId, status: "rejected", reason });
    }
  }

  for (const date of touchedDates) {
    const closedAt = await withVendorContext(ctx, async (client) => {
      const result = await client.query<{ closed_at: Date | null }>(
        `select closed_at from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
        [ctx.vendorId, date],
      );
      return result.rows[0]?.closed_at ?? null;
    });
    // Undefined overrides for waste/notes: recomputeDailySummary preserves
    // whatever is already stored for those, exactly like every other
    // recompute call in this codebase.
    if (closedAt) await recomputeDailySummary(ctx, date);
  }

  return outcomes;
}

function maskVendorId(vendorId: string): string {
  return vendorId.length < 8 ? "***" : vendorId.slice(0, 8) + "***";
}

interface AppliedRecord {
  outcome: SyncOutcome;
  /** Vendor-local date this record's ledger effect belongs to — set only
   *  when the outcome isn't 'rejected'. Absent for day_close (it recomputes
   *  itself directly, nothing more to do) and deni_customer (no ledger
   *  date to speak of). */
  touchedDate?: string;
}

async function applyOne(ctx: VendorContext, record: SyncRecord): Promise<AppliedRecord> {
  switch (record.type) {
    case "sale":
      return applySale(ctx, record.clientId, record.payload as SalePayload);
    case "expense":
      return applyExpense(ctx, record.clientId, record.payload as ExpensePayload);
    case "deni_customer":
      return applyDeniCustomer(ctx, record.clientId, record.payload as DeniCustomerPayload);
    case "deni_payment":
      return applyDeniPayment(ctx, record.clientId, record.payload as DeniPaymentPayload);
    case "sale_void":
      return applySaleVoid(ctx, record.clientId, record.payload as SaleVoidPayload);
    case "day_close":
      return applyDayClose(ctx, record.clientId, record.payload as DayClosePayload);
  }
}

async function applySale(ctx: VendorContext, clientId: string, payload: SalePayload): Promise<AppliedRecord> {
  const result = await recordSale(ctx, {
    clientId,
    soldAt: new Date(payload.soldAt),
    branchId: payload.branchId ?? null,
    recipeId: payload.recipeId ?? null,
    itemName: payload.itemName ?? null,
    quantity: payload.quantity,
    unitPriceTzs: payload.unitPriceTzs,
    totalTzs: payload.totalTzs,
    paymentMethod: payload.paymentMethod,
    deniCustomerName: payload.deniCustomerName ?? null,
  });

  const touchedDate = vendorLocalDate(result.sale.sold_at);
  if (result.created) return { outcome: { clientId, status: "applied", serverId: result.sale.id }, touchedDate };

  const existing = result.sale;
  // deniCustomerName is deliberately excluded from the comparison: it's
  // already fuzzy-matched (case/whitespace-insensitive) at resolution
  // time, so comparing raw strings here would flag harmless casing
  // differences as a "divergent payload" when they resolve to the exact
  // same customer.
  const matches =
    existing.sold_at.toISOString() === new Date(payload.soldAt).toISOString() &&
    (existing.branch_id ?? null) === (payload.branchId ?? null) &&
    (existing.recipe_id ?? null) === (payload.recipeId ?? null) &&
    (existing.item_name ?? null) === (payload.itemName ?? null) &&
    existing.quantity === payload.quantity &&
    existing.unit_price_tzs === payload.unitPriceTzs &&
    existing.total_tzs === payload.totalTzs &&
    existing.payment_method === payload.paymentMethod;

  if (matches) return { outcome: { clientId, status: "duplicate", serverId: existing.id }, touchedDate };
  return { outcome: { clientId, status: "rejected", serverId: existing.id, reason: "conflict_divergent_payload" } };
}

async function applyExpense(ctx: VendorContext, clientId: string, payload: ExpensePayload): Promise<AppliedRecord> {
  const result = await recordExpense(ctx, {
    clientId,
    spentAt: new Date(payload.spentAt),
    category: payload.category,
    description: payload.description ?? null,
    amountTzs: payload.amountTzs,
    planId: payload.planId ?? null,
  });

  const touchedDate = vendorLocalDate(result.expense.spent_at);
  if (result.created) return { outcome: { clientId, status: "applied", serverId: result.expense.id }, touchedDate };

  const existing = result.expense;
  const matches =
    existing.spent_at.toISOString() === new Date(payload.spentAt).toISOString() &&
    existing.category === payload.category &&
    (existing.description ?? null) === (payload.description ?? null) &&
    existing.amount_tzs === payload.amountTzs &&
    (existing.plan_id ?? null) === (payload.planId ?? null);

  if (matches) return { outcome: { clientId, status: "duplicate", serverId: existing.id }, touchedDate };
  return { outcome: { clientId, status: "rejected", serverId: existing.id, reason: "conflict_divergent_payload" } };
}

// deni_customer records have no client_id-keyed table to conflict against
// (pos.deni_customers dedups by normalized name, not client_id — see
// upsertDeniCustomer). There is no "divergent payload" concept here the
// way there is for a ledger row: resolving to an existing customer by name
// IS the correct, intended outcome, not a conflict. A phone number
// supplied on a record that resolves to an existing customer is not
// applied as an update — that would need an explicit action, not implicit
// sync-merge — so it's silently informational here.
async function applyDeniCustomer(
  ctx: VendorContext,
  clientId: string,
  payload: DeniCustomerPayload,
): Promise<AppliedRecord> {
  const result = await upsertDeniCustomer(ctx, payload.name, payload.phone ?? null);
  return {
    outcome: { clientId, status: result.created ? "applied" : "duplicate", serverId: result.customer.id },
  };
}

async function applyDeniPayment(ctx: VendorContext, clientId: string, payload: DeniPaymentPayload): Promise<AppliedRecord> {
  const result = await recordDeniPayment(ctx, {
    clientId,
    deniCustomerId: payload.deniCustomerId ?? null,
    deniCustomerName: payload.deniCustomerName ?? null,
    amountTzs: payload.amountTzs,
    paidAt: new Date(payload.paidAt),
  });

  const touchedDate = vendorLocalDate(result.payment.paid_at);
  if (result.created) return { outcome: { clientId, status: "applied", serverId: result.payment.id }, touchedDate };

  const existing = result.payment;
  const matches =
    existing.amount_tzs === payload.amountTzs && existing.paid_at.toISOString() === new Date(payload.paidAt).toISOString();

  if (matches) return { outcome: { clientId, status: "duplicate", serverId: existing.id }, touchedDate };
  return { outcome: { clientId, status: "rejected", serverId: existing.id, reason: "conflict_divergent_payload" } };
}

// sale_void has no client_id-keyed table either (voided/void_reason/
// voided_at live on the sale row itself) — its idempotency comes for free
// from voidSale's own no-op-on-already-voided behavior. A void record
// whose target sale doesn't exist (e.g. that sale was itself rejected
// earlier in this same batch for a divergent payload) is rejected with
// sale_not_found rather than silently doing nothing.
async function applySaleVoid(ctx: VendorContext, clientId: string, payload: SaleVoidPayload): Promise<AppliedRecord> {
  const sale = await withVendorContext(ctx, (client) =>
    voidSaleByClientIdInTx(client, ctx.vendorId, payload.saleClientId, payload.reason),
  );
  if (!sale) return { outcome: { clientId, status: "rejected", reason: "sale_not_found" } };
  // voidSaleInTx returns the pre-existing (already-voided) row unchanged
  // when called twice; voided_at not moving is how we'd know it was a
  // no-op, but comparing against "was already true before this call"
  // requires the pre-call state, which voidSaleByClientIdInTx doesn't
  // expose. Treating every successful void as "applied" is deliberately
  // simple here — repeating the exact same void_reason via the exact same
  // sale_void clientId is inherently a client-side retry of the same
  // action, and reporting it as duplicate vs. applied doesn't change what
  // the client needs to do next (nothing, either way).
  // touchedDate uses the SALE's own sold_at, not this void record's own
  // clientCreatedAt — a void affects the original sale's day's summary,
  // not "today".
  return { outcome: { clientId, status: "applied", serverId: sale.id }, touchedDate: vendorLocalDate(sale.sold_at) };
}

// day_close has no client_id-keyed table either — closeDay's own
// coalesce(closed_at, now()) makes a repeat close a no-op on closed_at
// while still recomputing. Because day_close sorts into the last tier,
// every other record in this batch has already been applied by the time
// this runs, so the recomputation it triggers sees the complete batch —
// satisfying "day-close records trigger summary recomputation at the end"
// through ordering alone, with no separate final pass needed.
async function applyDayClose(ctx: VendorContext, clientId: string, payload: DayClosePayload): Promise<AppliedRecord> {
  const before = await withVendorContext(ctx, async (client) => {
    const result = await client.query<{ closed_at: Date | null }>(
      `select closed_at from pos.daily_summaries where vendor_id = $1 and summary_date = $2`,
      [ctx.vendorId, payload.date],
    );
    return result.rows[0]?.closed_at ?? null;
  });

  const summary = await closeDay(ctx, payload.date, payload.wastePlates, payload.notes ?? null);
  return {
    outcome: {
      clientId,
      status: before ? "duplicate" : "applied",
      serverId: `${summary.vendor_id}:${summary.summary_date}`,
    },
    // No touchedDate: closeDay already recomputed this exact date directly
    // above, so re-adding it to applySyncBatch's touchedDates set would
    // only cause a redundant (harmless, but pointless) second recompute.
  };
}

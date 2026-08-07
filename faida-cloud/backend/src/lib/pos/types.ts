// Shared domain types and typed errors for the POS/Deni/Expenses services.
// No HTTP concerns here — routes translate these into responses.

export type PaymentMethod = "cash" | "mpesa" | "tigopesa" | "airtel" | "deni";

export type ExpenseCategory = "malighafi" | "mkaa" | "usafiri" | "kodi" | "maji" | "nyingine";

export interface SaleRow {
  id: string;
  vendor_id: string;
  branch_id: string | null;
  client_id: string;
  sold_at: Date;
  received_at: Date;
  recipe_id: string | null;
  item_name: string | null;
  quantity: number;
  unit_price_tzs: number;
  total_tzs: number;
  payment_method: PaymentMethod;
  deni_customer_id: string | null;
  voided: boolean;
  void_reason: string | null;
  voided_at: Date | null;
}

export interface DeniCustomerRow {
  id: string;
  vendor_id: string;
  name: string;
  phone: string | null;
}

export interface DeniPaymentRow {
  id: string;
  vendor_id: string;
  client_id: string;
  deni_customer_id: string;
  amount_tzs: number;
  paid_at: Date;
}

export interface ExpenseRow {
  id: string;
  vendor_id: string;
  client_id: string;
  spent_at: Date;
  category: ExpenseCategory;
  description: string | null;
  amount_tzs: number;
  plan_id: string | null;
}

export interface DailySummaryRow {
  vendor_id: string;
  summary_date: string; // YYYY-MM-DD
  revenue_tzs: number;
  cogs_tzs: number;
  other_exp_tzs: number;
  profit_tzs: number;
  plates_sold: number;
  plates_planned: number;
  waste_plates: number;
  deni_issued_tzs: number;
  closed_at: Date | null;
  recomputed_at: Date | null;
  notes: string | null;
}

// Sales/expenses may carry a non-fatal warning surfaced to the vendor (e.g.
// "the total you entered doesn't match quantity x unit price") without
// rejecting the record — her stated total is the money that actually
// changed hands, per Phase 4's governing principle.
export type ServiceWarningCode = "TOTAL_MISMATCH";

export interface ServiceWarning {
  code: ServiceWarningCode;
  message: string;
}

export class DeniBalanceExceededError extends Error {
  constructor(
    public readonly outstandingBalanceTzs: number,
    public readonly attemptedAmountTzs: number,
  ) {
    super(
      `deni payment of ${attemptedAmountTzs} TZS exceeds the customer's outstanding balance of ${outstandingBalanceTzs} TZS`,
    );
    this.name = "DeniBalanceExceededError";
  }
}

export class SaleNotFoundError extends Error {
  constructor(saleId: string) {
    super(`sale ${saleId} not found`);
    this.name = "SaleNotFoundError";
  }
}

export class DeniCustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`deni customer ${id} not found`);
    this.name = "DeniCustomerNotFoundError";
  }
}

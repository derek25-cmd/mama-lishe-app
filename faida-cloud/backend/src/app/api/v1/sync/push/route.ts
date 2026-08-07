import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { applySyncBatch, type SyncRecord } from "@/lib/pos";

const MAX_BATCH_SIZE = 500;
const PAYMENT_METHODS = ["cash", "mpesa", "tigopesa", "airtel", "deni"] as const;
const CATEGORIES = ["malighafi", "mkaa", "usafiri", "kodi", "maji", "nyingine"] as const;

const SaleRecord = z.object({
  type: z.literal("sale"),
  clientId: z.string().min(1).max(64),
  clientCreatedAt: z.string().datetime(),
  payload: z
    .object({
      soldAt: z.string().datetime(),
      branchId: z.string().uuid().optional(),
      recipeId: z.string().uuid().optional(),
      itemName: z.string().min(1).max(200).optional(),
      quantity: z.number().int().min(1),
      unitPriceTzs: z.number().int().min(0),
      totalTzs: z.number().int().min(0),
      paymentMethod: z.enum(PAYMENT_METHODS),
      deniCustomerName: z.string().min(1).max(200).optional(),
    })
    .refine((p) => p.paymentMethod !== "deni" || !!p.deniCustomerName, {
      message: "deniCustomerName is required when paymentMethod is 'deni'",
      path: ["deniCustomerName"],
    }),
});

const ExpenseRecord = z.object({
  type: z.literal("expense"),
  clientId: z.string().min(1).max(64),
  clientCreatedAt: z.string().datetime(),
  payload: z.object({
    spentAt: z.string().datetime(),
    category: z.enum(CATEGORIES),
    description: z.string().min(1).max(500).optional(),
    amountTzs: z.number().int().min(0),
    planId: z.string().uuid().optional(),
  }),
});

const DeniCustomerRecord = z.object({
  type: z.literal("deni_customer"),
  clientId: z.string().min(1).max(64),
  clientCreatedAt: z.string().datetime(),
  payload: z.object({
    name: z.string().min(1).max(200),
    phone: z.string().min(1).max(30).optional(),
  }),
});

const DeniPaymentRecord = z.object({
  type: z.literal("deni_payment"),
  clientId: z.string().min(1).max(64),
  clientCreatedAt: z.string().datetime(),
  payload: z
    .object({
      deniCustomerId: z.string().uuid().optional(),
      deniCustomerName: z.string().min(1).max(200).optional(),
      amountTzs: z.number().int().min(1),
      paidAt: z.string().datetime(),
    })
    .refine((p) => !!p.deniCustomerId || !!p.deniCustomerName, {
      message: "deniCustomerId or deniCustomerName is required",
      path: ["deniCustomerName"],
    }),
});

const SaleVoidRecord = z.object({
  type: z.literal("sale_void"),
  clientId: z.string().min(1).max(64),
  clientCreatedAt: z.string().datetime(),
  payload: z.object({
    saleClientId: z.string().min(1).max(64),
    reason: z.string().min(1).max(500),
  }),
});

const DayCloseRecord = z.object({
  type: z.literal("day_close"),
  clientId: z.string().min(1).max(64),
  clientCreatedAt: z.string().datetime(),
  payload: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    wastePlates: z.number().int().min(0),
    notes: z.string().max(1000).optional(),
  }),
});

const SyncRecordSchema = z.discriminatedUnion("type", [
  SaleRecord,
  ExpenseRecord,
  DeniCustomerRecord,
  DeniPaymentRecord,
  SaleVoidRecord,
  DayCloseRecord,
]);

const PushBody = z.object({
  deviceId: z.string().min(1).max(200),
  records: z.array(SyncRecordSchema).min(1).max(MAX_BATCH_SIZE),
});

export const POST = requireAuth(
  requireRole("vendor", "vendor_owner")(async (req, ctx) => {
    const parsed = PushBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    // Partial success is normal, not an error — HTTP 200 even when some
    // records are rejected (Task 4 spec). deviceId isn't currently used
    // beyond validation; it's accepted for forward compatibility with
    // per-device sync-state tracking that isn't part of this phase's scope.
    const results = await applySyncBatch(ctx, parsed.data.records as SyncRecord[]);
    return NextResponse.json({ results });
  }),
);

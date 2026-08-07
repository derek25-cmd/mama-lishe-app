import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { recordDeniPayment, DeniBalanceExceededError, DeniCustomerNotFoundError } from "@/lib/pos";

const RecordDeniPaymentBody = z.object({
  clientId: z.string().min(1).max(64),
  deniCustomerId: z.string().uuid(),
  amountTzs: z.number().int().min(1),
  paidAt: z.string().datetime(),
});

export const POST = requireAuth(
  requireRole("vendor", "vendor_owner")(async (req, ctx) => {
    const parsed = RecordDeniPaymentBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
    }

    try {
      const result = await recordDeniPayment(ctx, {
        clientId: parsed.data.clientId,
        deniCustomerId: parsed.data.deniCustomerId,
        amountTzs: parsed.data.amountTzs,
        paidAt: new Date(parsed.data.paidAt),
      });
      return NextResponse.json({ payment: result.payment }, { status: result.created ? 201 : 200 });
    } catch (err) {
      if (err instanceof DeniBalanceExceededError) {
        return NextResponse.json(
          {
            error: "deni_balance_exceeded",
            outstandingBalanceTzs: err.outstandingBalanceTzs,
            attemptedAmountTzs: err.attemptedAmountTzs,
          },
          { status: 422 },
        );
      }
      if (err instanceof DeniCustomerNotFoundError) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      throw err;
    }
  }),
);

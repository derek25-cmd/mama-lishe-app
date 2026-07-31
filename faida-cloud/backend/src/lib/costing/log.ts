import pino from "pino";

const logger = pino({ name: "faida-costing" });

// 3bf7701d-5c80-461b-9859-2a786e1e8287 -> 3bf7701d***. Same masking
// convention as auth/phone.ts's maskPhone — enough to correlate repeated
// requests from the same vendor in logs without the full id being usable
// to look the vendor up directly.
export function maskVendorId(vendorId: string): string {
  if (vendorId.length < 8) return "***";
  return vendorId.slice(0, 8) + "***";
}

export interface CostingLogFields {
  vendorId: string;
  marketId: string | null;
  dishCount: number;
  plates: number; // total plates across all dishes in the plan
  priceWeek: string | null;
  durationMs: number;
  cacheHit: boolean;
}

export function logCostingRequest(fields: CostingLogFields): void {
  logger.info(
    {
      vendor_id: maskVendorId(fields.vendorId),
      market_id: fields.marketId,
      dish_count: fields.dishCount,
      plates: fields.plates,
      price_week: fields.priceWeek,
      duration_ms: fields.durationMs,
      cache_hit: fields.cacheHit,
    },
    "costing request",
  );
}

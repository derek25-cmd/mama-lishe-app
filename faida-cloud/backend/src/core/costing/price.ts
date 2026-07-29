import type { Confidence, MarketPriceSnapshot, PricedIngredient, PricingInput } from "./types.js";

// (c) Price a list of quantities from a supplied market snapshot, falling
// back market -> region average -> forecast. Confidence stays within DOC 05's
// price.market_prices.confidence enum (high|medium|low|forecast): a region
// average is an approximation across markets, so it is tagged 'low'.
export function priceIngredients(
  inputs: PricingInput[],
  snapshot: MarketPriceSnapshot,
): PricedIngredient[] {
  return inputs.map((input) => priceOne(input, snapshot));
}

function priceOne(input: PricingInput, snapshot: MarketPriceSnapshot): PricedIngredient {
  const resolved = resolvePrice(input.ingredientId, snapshot);
  if (!resolved) {
    throw new Error(`no price available for ingredient ${input.ingredientId} (market, region average, forecast all missing)`);
  }
  const costTzs = Math.ceil((input.qty / 1000) * resolved.pricePerKgTzs);
  return {
    ingredientId: input.ingredientId,
    qty: input.qty,
    pricePerKgTzs: resolved.pricePerKgTzs,
    confidence: resolved.confidence,
    source: resolved.source,
    costTzs,
  };
}

function resolvePrice(
  ingredientId: string,
  snapshot: MarketPriceSnapshot,
): { pricePerKgTzs: number; confidence: Confidence; source: "market" | "region_average" | "forecast" } | null {
  const marketEntry = snapshot.market[ingredientId];
  if (marketEntry) {
    return { pricePerKgTzs: marketEntry.pricePerKgTzs, confidence: marketEntry.confidence, source: "market" };
  }

  const regionAvg = snapshot.regionAverage[ingredientId];
  if (regionAvg !== undefined) {
    return { pricePerKgTzs: regionAvg, confidence: "low", source: "region_average" };
  }

  const forecast = snapshot.forecast[ingredientId];
  if (forecast !== undefined) {
    return { pricePerKgTzs: forecast, confidence: "forecast", source: "forecast" };
  }

  return null;
}

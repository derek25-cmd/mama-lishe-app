import type { MergedLine, PriceSnapshot, PricedLine, CostingWarning } from "./types.js";

export interface PriceIngredientsResult {
  lines: PricedLine[];
  warnings: CostingWarning[];
}

// Fallback chain, in order: (1) the vendor's own market this week, (2) the
// region average this week, (3) the forecast table. Whichever tier
// resolves, that entry's own `confidence` is used verbatim — this function
// doesn't re-derive confidence, the repository layer tags each snapshot's
// entries correctly before they ever get here (see types.ts).
//
// If all three miss, the ingredient is never silently dropped: it comes
// back with price_per_kg_tzs 0, confidence 'none', is_estimate true, and a
// MISSING_PRICE warning naming it — the caller decides how to surface an
// unpriced line, but the total is never quietly under-costed.
export function priceIngredients(
  mergedLines: MergedLine[],
  snapshot: PriceSnapshot,
  regionSnapshot: PriceSnapshot,
  forecastSnapshot: PriceSnapshot,
): PriceIngredientsResult {
  const warnings: CostingWarning[] = [];

  const lines = mergedLines.map((line): PricedLine => {
    const resolved = snapshot[line.ingredient_id] ?? regionSnapshot[line.ingredient_id] ?? forecastSnapshot[line.ingredient_id];

    if (!resolved) {
      warnings.push({
        code: "MISSING_PRICE",
        ingredient_id: line.ingredient_id,
        message: `No price available for ${line.ingredient_id} in market, region, or forecast tiers.`,
      });
      return {
        ...line,
        price_per_kg_tzs: 0 as PricedLine["price_per_kg_tzs"],
        confidence: "none",
        is_estimate: true,
      };
    }

    return {
      ...line,
      price_per_kg_tzs: resolved.price_per_kg_tzs,
      confidence: resolved.confidence,
      is_estimate: resolved.confidence !== "high",
    };
  });

  return { lines, warnings };
}

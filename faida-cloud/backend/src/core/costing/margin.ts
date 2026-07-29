import type { MarginResult } from "./types.js";

// (e) Margin math. Money is integer TZS everywhere: cost/plate rounds up
// (never let the app undercount a vendor's cost), recommended price snaps
// up to the nearest 500 TZS (the smallest note vendors actually price in).
export function computeMargin(totalCostTzs: number, plates: number, targetMarginPct: number): MarginResult {
  if (!(plates >= 1)) {
    throw new Error(`plates must be >= 1, got ${plates}`);
  }
  if (!(targetMarginPct >= 0 && targetMarginPct < 100)) {
    throw new Error(`targetMarginPct must be in [0, 100), got ${targetMarginPct}`);
  }

  const costPerPlateTzs = Math.ceil(totalCostTzs / plates);
  const marginFraction = targetMarginPct / 100;
  const rawPrice = costPerPlateTzs / (1 - marginFraction);
  const recommendedPriceTzs = Math.ceil(rawPrice / 500) * 500;

  return { costPerPlateTzs, recommendedPriceTzs };
}

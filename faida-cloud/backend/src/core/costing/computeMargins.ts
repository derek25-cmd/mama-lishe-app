import type { TZS, DishCosting } from "./types.js";
import { tzs } from "./types.js";

export interface DishCostInput {
  recipe_id: string;
  plates: number;
  dish_cost_tzs: TZS;
}

const PRICE_SNAP_TZS = 500; // Tanzanian street price points

// cost/plate: integer division rounded UP — never understate cost.
// recommended price: cost/plate / (1 - margin), snapped UP to the nearest
// 500 TZS. Snapping usually pushes the real margin above target, so the
// achieved margin at that snapped price is recomputed and returned — the
// vendor should see the true figure, not the target she asked for.
export function computeMargins(dishes: DishCostInput[], targetMarginPct: number): DishCosting[] {
  if (!(targetMarginPct >= 0 && targetMarginPct < 100)) {
    throw new Error(`targetMarginPct must be in [0, 100), got ${targetMarginPct}`);
  }

  return dishes.map((dish) => {
    const costPerPlate = Math.ceil(dish.dish_cost_tzs / dish.plates);
    const marginFraction = targetMarginPct / 100;
    const rawPrice = costPerPlate / (1 - marginFraction);
    // (1 - marginFraction) is rarely exact in IEEE-754 (e.g. 1 - 0.8 =
    // 0.19999999999999998), which can push rawPrice a hair past a 500-TZS
    // boundary it shouldn't cross (5000.000000000001 instead of exactly
    // 5000) and snap to the wrong multiple. TZS has no fractional unit, so
    // cleaning up sub-thousandth noise before the ceiling step is exact
    // for every real input, never a loss of precision that matters.
    const cleanedRawPrice = Math.round(rawPrice * 1000) / 1000;
    const recommendedPrice = Math.ceil(cleanedRawPrice / PRICE_SNAP_TZS) * PRICE_SNAP_TZS;
    const achievedMarginPct = (1 - costPerPlate / recommendedPrice) * 100;

    return {
      recipe_id: dish.recipe_id,
      plates: dish.plates,
      dish_cost_tzs: dish.dish_cost_tzs,
      cost_per_plate_tzs: tzs(costPerPlate),
      recommended_price_tzs: tzs(recommendedPrice),
      achieved_margin_pct: achievedMarginPct,
    };
  });
}

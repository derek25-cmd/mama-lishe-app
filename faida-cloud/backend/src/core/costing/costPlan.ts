import type { PlanRequest, CostingData, CostingResult, ShoppingLine, DishCosting } from "./types.js";
import { tzs } from "./types.js";
import { scaleRecipe } from "./scaleRecipe.js";
import { mergeIngredients } from "./mergeIngredients.js";
import { priceIngredients } from "./priceIngredients.js";
import { toMarketUnits } from "./toMarketUnits.js";
import { computeMargins } from "./computeMargins.js";

// The single exported orchestrator. Rounding happens in exactly two
// places, both documented at the source:
//   (1) toMarketUnits.ts rounds quantities UP to buyable market units
//       before costing a line (DOC 02 §5.3's buyability rules) — a vendor
//       pays for the whole bag she buys, not the theoretical requirement.
//   (2) computeMargins.ts rounds cost/plate UP (never understate cost) and
//       snaps the recommended price UP to the nearest 500 TZS.
// Scaling, merging, and apportionment below stay exact — no float money
// anywhere, and apportionment uses the largest-remainder method so a
// shared ingredient's per-dish shares always sum back to that line's exact
// integer cost. No shilling is ever lost or gained to independent rounding.
export function costPlan(request: PlanRequest, data: CostingData): CostingResult {
  const scaledDishes = request.items.map((item, index) => scaleRecipe(item.recipe, item.plates, index));
  const merged = mergeIngredients(scaledDishes);
  const { lines: priced, warnings } = priceIngredients(
    merged,
    data.priceSnapshot,
    data.regionSnapshot,
    data.forecastSnapshot,
  );

  const shoppingLines: ShoppingLine[] = priced.map((line) => toMarketUnits(line, data.unitTable, data.ingredientMeta));

  const dishCostByIndex = new Map<number, number>();
  for (let i = 0; i < priced.length; i++) {
    const mergedLine = priced[i]!;
    const shares = apportion(shoppingLines[i]!.line_cost_tzs, mergedLine.contributions, mergedLine.total_qty_g);
    for (const share of shares) {
      dishCostByIndex.set(share.plan_index, (dishCostByIndex.get(share.plan_index) ?? 0) + share.share_tzs);
    }
  }

  const dishCostInputs = scaledDishes.map((dish) => ({
    recipe_id: dish.recipe_id,
    plates: dish.plates,
    dish_cost_tzs: tzs(dishCostByIndex.get(dish.plan_index) ?? 0),
  }));
  const dishes: DishCosting[] = computeMargins(dishCostInputs, request.target_margin_pct);

  const totalCostTzs = shoppingLines.reduce((sum, l) => sum + l.line_cost_tzs, 0);

  return {
    lines: shoppingLines,
    dishes,
    total_cost_tzs: tzs(totalCostTzs),
    price_week: findPriceWeek(data),
    warnings,
  };
}

interface ApportionShare {
  plan_index: number;
  share_tzs: number;
}

// Largest-remainder (Hamilton) apportionment: guarantees the returned
// shares sum to exactly lineCostTzs, never off by a shilling from
// independent per-dish rounding.
function apportion(
  lineCostTzs: number,
  contributions: { plan_index: number; qty_g: number }[],
  totalQtyG: number,
): ApportionShare[] {
  if (contributions.length === 1) {
    return [{ plan_index: contributions[0]!.plan_index, share_tzs: lineCostTzs }];
  }

  const raw = contributions.map((c) => (c.qty_g / totalQtyG) * lineCostTzs);
  const floors = raw.map(Math.floor);
  const flooredSum = floors.reduce((a, b) => a + b, 0);
  let remainder = lineCostTzs - flooredSum;

  const order = raw.map((r, i) => ({ i, frac: r - floors[i]! })).sort((a, b) => b.frac - a.frac);

  const shares = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    shares[order[k]!.i]! += 1;
  }

  return contributions.map((c, i) => ({ plan_index: c.plan_index, share_tzs: shares[i]! }));
}

// Every entry in a given snapshot comes from the same repository call
// (loadPriceSnapshot(marketId, weekStart) etc.), so week_start is uniform
// within a snapshot — any resolved entry's week identifies the whole plan.
function findPriceWeek(data: CostingData): string | null {
  const fromMarket = Object.values(data.priceSnapshot)[0];
  if (fromMarket) return fromMarket.week_start;
  const fromRegion = Object.values(data.regionSnapshot)[0];
  if (fromRegion) return fromRegion.week_start;
  const fromForecast = Object.values(data.forecastSnapshot)[0];
  if (fromForecast) return fromForecast.week_start;
  return null;
}

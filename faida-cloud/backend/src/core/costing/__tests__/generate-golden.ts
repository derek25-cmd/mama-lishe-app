// Dev-only: regenerates committed golden files from actual code execution.
// Run with `npx tsx src/core/costing/__tests__/generate-golden.ts` whenever
// a fixture intentionally changes. Never imported by test code.
//
// Per the standing rule: single-dish and multi-dish were hand-verified in
// hand-verification.md BEFORE this script was ever run — this generates
// the rest trusting the same (by-then-proven) functions, not the other
// way around.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { costPlan } from "../costPlan.js";
import { toMarketUnits } from "../toMarketUnits.js";
import { computeMargins } from "../computeMargins.js";
import { priceIngredients } from "../priceIngredients.js";
import { tzs, type CostingData, type MergedLine, type PricedLine } from "../types.js";
import {
  ingredientMeta,
  unitTable,
  pilauRecipe,
  waliMaharageRecipe,
  marketSnapshot,
  regionSnapshot,
  forecastSnapshot,
  emptySnapshot,
} from "./fixtures/data.js";

const dir = dirname(fileURLToPath(import.meta.url));
const write = (name: string, data: unknown) =>
  writeFileSync(join(dir, "golden", name), JSON.stringify(data, null, 2) + "\n");

const fullData: CostingData = {
  priceSnapshot: marketSnapshot,
  regionSnapshot: emptySnapshot,
  forecastSnapshot: emptySnapshot,
  unitTable,
  ingredientMeta,
};

// ---------- single dish (hand-verified: Fixture A) ----------
write("single-dish.json", costPlan({ items: [{ recipe: pilauRecipe, plates: 60 }], target_margin_pct: 40 }, fullData));

// ---------- multi-dish, shared ingredients (hand-verified: Fixture B) ----------
write(
  "multi-dish.json",
  costPlan(
    {
      items: [
        { recipe: pilauRecipe, plates: 60 },
        { recipe: waliMaharageRecipe, plates: 30 },
      ],
      target_margin_pct: 35,
    },
    fullData,
  ),
);

// ---------- price fallback: market hit, region fallback, forecast fallback, total miss ----------
function mergedLine(id: string, qtyG: number): MergedLine {
  return {
    ingredient_id: id,
    total_qty_g: qtyG,
    contributions: [{ plan_index: 0, recipe_id: "r", qty_g: qtyG, plates: 10 }],
  };
}
write("price-fallback-market.json", priceIngredients([mergedLine("rice", 1000)], marketSnapshot, emptySnapshot, emptySnapshot));
write("price-fallback-region.json", priceIngredients([mergedLine("cabbage", 1000)], emptySnapshot, regionSnapshot, emptySnapshot));
write("price-fallback-forecast.json", priceIngredients([mergedLine("cabbage", 1000)], emptySnapshot, emptySnapshot, forecastSnapshot));
write("price-fallback-missing.json", priceIngredients([mergedLine("cabbage", 1000)], emptySnapshot, emptySnapshot, emptySnapshot));

// ---------- rounding thresholds: just below / just above each rule's boundary ----------
function priced(id: string, qtyG: number): PricedLine {
  const entry = marketSnapshot[id]!;
  return {
    ingredient_id: id,
    total_qty_g: qtyG,
    contributions: [{ plan_index: 0, recipe_id: "r", qty_g: qtyG, plates: 10 }],
    price_per_kg_tzs: entry.price_per_kg_tzs,
    confidence: "high",
    is_estimate: false,
  };
}
write("rounding-thresholds.json", {
  // informal unit (onion, fungu=250g): just below vs just above 2 fungu
  fungu_just_below_2: toMarketUnits(priced("onion", 497.5), unitTable, ingredientMeta), // -> ceil(497.5/250)=2
  fungu_just_above_2: toMarketUnits(priced("onion", 502.5), unitTable, ingredientMeta), // -> ceil(502.5/250)=3
  // nyama (meat): just below vs just above the 0.25kg (250g) boundary
  meat_just_below_step: toMarketUnits(priced("meat", 249), unitTable, ingredientMeta), // -> 250g (1 step)
  meat_just_above_step: toMarketUnits(priced("meat", 260), unitTable, ingredientMeta), // -> 500g (2 steps)
  // nafaka (rice): just below vs just above the 0.5kg (500g) boundary
  rice_just_below_step: toMarketUnits(priced("rice", 490), unitTable, ingredientMeta), // -> 500g (1 step)
  rice_just_above_step: toMarketUnits(priced("rice", 510), unitTable, ingredientMeta), // -> 1000g (2 steps)
  // mafuta (oil): just below vs just above a clean 1L bottle
  oil_just_below_1L: toMarketUnits(priced("oil", 1000), unitTable, ingredientMeta), // -> exactly one 1L bottle
  oil_just_above_1L: toMarketUnits(priced("oil", 1010), unitTable, ingredientMeta), // -> 1L + 500ml (2 bottles)
  // informal unit -> kilo switch: just below vs just above 4x the largest informal unit (fungu, 250g -> 1000g)
  onion_just_below_kilo_switch: toMarketUnits(priced("onion", 995), unitTable, ingredientMeta), // <=1000g, stays fungu
  onion_just_above_kilo_switch: toMarketUnits(priced("onion", 1005), unitTable, ingredientMeta), // >1000g, switches to kilo
});

// ---------- spice (viungo) allowance path ----------
const spicePrice = marketSnapshot.pilau_masala!.price_per_kg_tzs;
write("spice-allowance.json", {
  single_dish_60_plates: toMarketUnits(
    {
      ingredient_id: "pilau_masala",
      total_qty_g: 600,
      contributions: [{ plan_index: 0, recipe_id: "pilau_ya_nyama", qty_g: 600, plates: 60 }],
      price_per_kg_tzs: spicePrice,
      confidence: "high",
      is_estimate: false,
    },
    unitTable,
    ingredientMeta,
  ),
  shared_across_two_dishes: toMarketUnits(
    {
      ingredient_id: "pilau_masala",
      total_qty_g: 900,
      contributions: [
        { plan_index: 0, recipe_id: "pilau_ya_nyama", qty_g: 600, plates: 60 },
        { plan_index: 1, recipe_id: "other_dish", qty_g: 300, plates: 20 },
      ],
      price_per_kg_tzs: spicePrice,
      confidence: "high",
      is_estimate: false,
    },
    unitTable,
    ingredientMeta,
  ),
});

// ---------- margin snapping: a case where the snap visibly changes achieved margin ----------
write("margin-snapping.json", {
  exact_multiple_of_500: computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(30000) }], 40), // cost/plate 3000, raw price 5000 exact
  snap_pushes_margin_up: computeMargins([{ recipe_id: "d1", plates: 60, dish_cost_tzs: tzs(290100) }], 40), // Fixture A's numbers: 40% target -> 43.12% achieved
  zero_margin: computeMargins([{ recipe_id: "d1", plates: 3, dish_cost_tzs: tzs(12345) }], 0),
  high_margin_near_100: computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(10000) }], 80),
});

// ---------- scale extremes: minimum (1 plate) and large (500 plates) ----------
write("min-plan.json", costPlan({ items: [{ recipe: pilauRecipe, plates: 1 }], target_margin_pct: 40 }, fullData));
write("large-plan.json", costPlan({ items: [{ recipe: pilauRecipe, plates: 500 }], target_margin_pct: 40 }, fullData));

console.log("golden fixtures regenerated");

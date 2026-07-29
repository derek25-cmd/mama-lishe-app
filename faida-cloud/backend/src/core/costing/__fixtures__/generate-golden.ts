// Dev-only helper: regenerates the committed golden JSON files from the
// actual pipeline output. Run with `npx tsx src/core/costing/__fixtures__/generate-golden.ts`
// whenever a fixture input intentionally changes. Never imported by test code.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { priceCookPlan, computeMargin, convertToBuyable } from "../index.js";
import { ingredients, informalUnits, recipes, buguruniSnapshot } from "./pilau.js";

const dir = dirname(fileURLToPath(import.meta.url));
const write = (name: string, data: unknown) => {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2) + "\n");
};

// single dish: Pilau ya Nyama x60 plates, 40% target margin
write(
  "single-dish.golden.json",
  priceCookPlan({
    dishes: [{ recipeId: "pilau_ya_nyama", plates: 60 }],
    recipes,
    ingredients,
    informalUnits,
    priceSnapshot: buguruniSnapshot,
    targetMarginPct: 40,
  }),
);

// multi-dish merge: Pilau x60 + Wali Kavu x20 share rice & oil
write(
  "multi-dish.golden.json",
  priceCookPlan({
    dishes: [
      { recipeId: "pilau_ya_nyama", plates: 60 },
      { recipeId: "wali_kavu", plates: 20 },
    ],
    recipes,
    ingredients,
    informalUnits,
    priceSnapshot: buguruniSnapshot,
    targetMarginPct: 35,
  }),
);

// missing price fallback: cabbage has no market price, only region average
// and forecast (region average must win)
write(
  "missing-price-fallback-region-avg.golden.json",
  priceCookPlan({
    dishes: [{ recipeId: "cabbage_only", plates: 10 }],
    recipes: {
      cabbage_only: { id: "cabbage_only", basePlates: 10, ingredients: [{ ingredientId: "cabbage", qtyPerBase: 1800 }] },
    },
    ingredients,
    informalUnits,
    priceSnapshot: buguruniSnapshot,
    targetMarginPct: 30,
  }),
);

// missing price fallback: forecast-only (no market, no region average)
write(
  "missing-price-fallback-forecast.golden.json",
  priceCookPlan({
    dishes: [{ recipeId: "cabbage_only", plates: 10 }],
    recipes: {
      cabbage_only: { id: "cabbage_only", basePlates: 10, ingredients: [{ ingredientId: "cabbage", qtyPerBase: 1800 }] },
    },
    ingredients,
    informalUnits,
    priceSnapshot: { market: {}, regionAverage: {}, forecast: { cabbage: 1300 } },
    targetMarginPct: 30,
  }),
);

// rounding edge cases: exact-fit and remainder bottle packing, exact-fit and
// remainder step rounding, mboga exact-fit informal units
write("rounding-edge-cases.golden.json", {
  meatExactFit: convertToBuyable(ingredients.meat!, { ingredientId: "meat", canonicalQty: 4500 }, 60, undefined),
  meatRemainder: convertToBuyable(ingredients.meat!, { ingredientId: "meat", canonicalQty: 4501 }, 60, undefined),
  grainExactFit: convertToBuyable(ingredients.rice!, { ingredientId: "rice", canonicalQty: 5000 }, 60, undefined),
  grainRemainder: convertToBuyable(ingredients.rice!, { ingredientId: "rice", canonicalQty: 5001 }, 60, undefined),
  oilExactMultiple: convertToBuyable(ingredients.oil!, { ingredientId: "oil", canonicalQty: 3000 }, 60, undefined),
  oilWithRemainderNewBucket: convertToBuyable(ingredients.oil!, { ingredientId: "oil", canonicalQty: 2300 }, 60, undefined),
  oilWithRemainderExistingBucket: convertToBuyable(ingredients.oil!, { ingredientId: "oil", canonicalQty: 5750 }, 60, undefined),
  mbogaExactFit: convertToBuyable(ingredients.onion!, { ingredientId: "onion", canonicalQty: 500 }, 60, informalUnits.onion),
  mbogaRemainder: convertToBuyable(ingredients.onion!, { ingredientId: "onion", canonicalQty: 501 }, 60, informalUnits.onion),
});

// margin snapping: exact multiple of 500 already, and a value needing snap-up
write("margin-snapping.golden.json", {
  exactMultiple: computeMargin(30000, 10, 40), // cost/plate*(1/(1-.4)) lands cleanly
  needsSnapUp: computeMargin(4675 * 60, 60, 40),
  zeroMargin: computeMargin(12345, 3, 0),
  highMargin: computeMargin(10000, 10, 80),
});

console.log("golden fixtures regenerated");

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { costPlan } from "../costPlan.js";
import type { CostingData } from "../types.js";
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
function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, "golden", name), "utf8"));
}

const fullData: CostingData = {
  priceSnapshot: marketSnapshot,
  regionSnapshot: emptySnapshot,
  forecastSnapshot: emptySnapshot,
  unitTable,
  ingredientMeta,
};

describe("costPlan — golden files (hand-verified in hand-verification.md)", () => {
  it("single dish: Pilau ya Nyama x60, 40% margin", () => {
    const result = costPlan({ items: [{ recipe: pilauRecipe, plates: 60 }], target_margin_pct: 40 }, fullData);
    expect(result).toEqual(golden("single-dish.json"));
  });

  it("multi-dish: Pilau x60 + Wali Maharage x30 share rice & oil, 35% margin — apportionment sums exactly, no lost shilling", () => {
    const result = costPlan(
      {
        items: [
          { recipe: pilauRecipe, plates: 60 },
          { recipe: waliMaharageRecipe, plates: 30 },
        ],
        target_margin_pct: 35,
      },
      fullData,
    );
    expect(result).toEqual(golden("multi-dish.json"));

    const sumOfDishCosts = result.dishes.reduce((sum, d) => sum + d.dish_cost_tzs, 0);
    expect(sumOfDishCosts).toBe(result.total_cost_tzs);
  });

  it("minimum plan: 1 plate", () => {
    const result = costPlan({ items: [{ recipe: pilauRecipe, plates: 1 }], target_margin_pct: 40 }, fullData);
    expect(result).toEqual(golden("min-plan.json"));
  });

  it("large plan: 500 plates", () => {
    const result = costPlan({ items: [{ recipe: pilauRecipe, plates: 500 }], target_margin_pct: 40 }, fullData);
    expect(result).toEqual(golden("large-plan.json"));

    const sumOfDishCosts = result.dishes.reduce((sum, d) => sum + d.dish_cost_tzs, 0);
    expect(sumOfDishCosts).toBe(result.total_cost_tzs);
  });

  it("rejects an unknown recipe id reference", () => {
    expect(() =>
      costPlan(
        { items: [{ recipe: { ...pilauRecipe, base_plates: 0 }, plates: 10 }], target_margin_pct: 40 },
        fullData,
      ),
    ).toThrow(/invalid base_plates/);
  });
});

describe("costPlan — price_week derivation", () => {
  const cabbageOnly = {
    id: "cabbage_only",
    name_sw: "Cabbage only",
    base_plates: 10,
    ingredients: [{ ingredient_id: "cabbage", qty_per_base: 900, is_optional: false }],
  };

  it("falls back to the region snapshot's week when the market snapshot is empty", () => {
    const result = costPlan(
      { items: [{ recipe: cabbageOnly, plates: 10 }], target_margin_pct: 40 },
      { priceSnapshot: emptySnapshot, regionSnapshot, forecastSnapshot: emptySnapshot, unitTable, ingredientMeta },
    );
    expect(result.price_week).toBe(regionSnapshot.cabbage!.week_start);
  });

  it("falls back to the forecast snapshot's week when both market and region are empty", () => {
    const result = costPlan(
      { items: [{ recipe: cabbageOnly, plates: 10 }], target_margin_pct: 40 },
      { priceSnapshot: emptySnapshot, regionSnapshot: emptySnapshot, forecastSnapshot, unitTable, ingredientMeta },
    );
    expect(result.price_week).toBe(forecastSnapshot.cabbage!.week_start);
  });

  it("is null when every tier is empty — and every line carries a MISSING_PRICE warning", () => {
    const result = costPlan(
      { items: [{ recipe: cabbageOnly, plates: 10 }], target_margin_pct: 40 },
      { priceSnapshot: emptySnapshot, regionSnapshot: emptySnapshot, forecastSnapshot: emptySnapshot, unitTable, ingredientMeta },
    );
    expect(result.price_week).toBeNull();
    expect(result.warnings).toEqual([
      { code: "MISSING_PRICE", ingredient_id: "cabbage", message: expect.any(String) },
    ]);
  });
});

describe("costPlan — dish with no ingredients", () => {
  it("costs a zero-ingredient dish at 0 TZS instead of leaving it undefined", () => {
    const emptyDish = {
      id: "empty_dish",
      name_sw: "Empty",
      base_plates: 10,
      ingredients: [],
    };
    const result = costPlan({ items: [{ recipe: emptyDish, plates: 10 }], target_margin_pct: 40 }, fullData);
    expect(result.dishes).toHaveLength(1);
    expect(result.dishes[0]!.dish_cost_tzs).toBe(0);
    expect(result.dishes[0]!.cost_per_plate_tzs).toBe(0);
  });
});

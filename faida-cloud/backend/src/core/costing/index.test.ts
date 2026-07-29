import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceCookPlan } from "./index.js";
import { ingredients, informalUnits, recipes, buguruniSnapshot } from "./__fixtures__/pilau.js";

const dir = dirname(fileURLToPath(import.meta.url));
function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, "__fixtures__", name), "utf8"));
}

describe("priceCookPlan — golden files", () => {
  it("single dish: Pilau ya Nyama x60, 40% margin", () => {
    const result = priceCookPlan({
      dishes: [{ recipeId: "pilau_ya_nyama", plates: 60 }],
      recipes,
      ingredients,
      informalUnits,
      priceSnapshot: buguruniSnapshot,
      targetMarginPct: 40,
    });
    expect(result).toEqual(golden("single-dish.golden.json"));
  });

  it("multi-dish merge: Pilau x60 + Wali Kavu x20 share rice & oil, 35% margin", () => {
    const result = priceCookPlan({
      dishes: [
        { recipeId: "pilau_ya_nyama", plates: 60 },
        { recipeId: "wali_kavu", plates: 20 },
      ],
      recipes,
      ingredients,
      informalUnits,
      priceSnapshot: buguruniSnapshot,
      targetMarginPct: 35,
    });
    expect(result).toEqual(golden("multi-dish.golden.json"));
  });

  it("missing price: falls back to region average when only that tier has data", () => {
    const result = priceCookPlan({
      dishes: [{ recipeId: "cabbage_only", plates: 10 }],
      recipes: {
        cabbage_only: { id: "cabbage_only", basePlates: 10, ingredients: [{ ingredientId: "cabbage", qtyPerBase: 1800 }] },
      },
      ingredients,
      informalUnits,
      priceSnapshot: buguruniSnapshot,
      targetMarginPct: 30,
    });
    expect(result).toEqual(golden("missing-price-fallback-region-avg.golden.json"));
  });

  it("missing price: falls back to forecast when market and region average are both absent", () => {
    const result = priceCookPlan({
      dishes: [{ recipeId: "cabbage_only", plates: 10 }],
      recipes: {
        cabbage_only: { id: "cabbage_only", basePlates: 10, ingredients: [{ ingredientId: "cabbage", qtyPerBase: 1800 }] },
      },
      ingredients,
      informalUnits,
      priceSnapshot: { market: {}, regionAverage: {}, forecast: { cabbage: 1300 } },
      targetMarginPct: 30,
    });
    expect(result).toEqual(golden("missing-price-fallback-forecast.golden.json"));
  });
});

describe("priceCookPlan — error paths", () => {
  it("throws on an unknown recipe id", () => {
    expect(() =>
      priceCookPlan({
        dishes: [{ recipeId: "nonexistent", plates: 10 }],
        recipes,
        ingredients,
        informalUnits,
        priceSnapshot: buguruniSnapshot,
        targetMarginPct: 30,
      }),
    ).toThrow(/unknown recipe nonexistent/);
  });

  it("throws on an ingredient missing from the ingredients catalog", () => {
    expect(() =>
      priceCookPlan({
        dishes: [{ recipeId: "ghost", plates: 10 }],
        recipes: { ghost: { id: "ghost", basePlates: 10, ingredients: [{ ingredientId: "phantom", qtyPerBase: 100 }] } },
        ingredients,
        informalUnits,
        priceSnapshot: buguruniSnapshot,
        targetMarginPct: 30,
      }),
    ).toThrow(/unknown ingredient phantom/);
  });
});

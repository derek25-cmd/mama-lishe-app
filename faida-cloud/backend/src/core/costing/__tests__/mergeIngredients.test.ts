import { describe, expect, it } from "vitest";
import { mergeIngredients } from "../mergeIngredients.js";

describe("mergeIngredients", () => {
  it("returns an empty list for no dishes", () => {
    expect(mergeIngredients([])).toEqual([]);
  });

  it("sums shared ingredients across dishes, sorted by id, and records per-dish contributions with plates", () => {
    const result = mergeIngredients([
      {
        plan_index: 0,
        recipe_id: "pilau_ya_nyama",
        plates: 60,
        ingredients: [
          { ingredient_id: "rice", qty_g: 12000, is_optional: false },
          { ingredient_id: "oil", qty_g: 3000, is_optional: false },
        ],
      },
      {
        plan_index: 1,
        recipe_id: "wali_maharage",
        plates: 30,
        ingredients: [
          { ingredient_id: "rice", qty_g: 4500, is_optional: false },
          { ingredient_id: "oil", qty_g: 600, is_optional: false },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        ingredient_id: "oil",
        total_qty_g: 3600,
        contributions: [
          { plan_index: 0, recipe_id: "pilau_ya_nyama", qty_g: 3000, plates: 60 },
          { plan_index: 1, recipe_id: "wali_maharage", qty_g: 600, plates: 30 },
        ],
      },
      {
        ingredient_id: "rice",
        total_qty_g: 16500,
        contributions: [
          { plan_index: 0, recipe_id: "pilau_ya_nyama", qty_g: 12000, plates: 60 },
          { plan_index: 1, recipe_id: "wali_maharage", qty_g: 4500, plates: 30 },
        ],
      },
    ]);
  });

  it("keeps two separate plan items for the same recipe distinct via plan_index", () => {
    const result = mergeIngredients([
      { plan_index: 0, recipe_id: "pilau_ya_nyama", plates: 10, ingredients: [{ ingredient_id: "rice", qty_g: 1000, is_optional: false }] },
      { plan_index: 1, recipe_id: "pilau_ya_nyama", plates: 20, ingredients: [{ ingredient_id: "rice", qty_g: 2000, is_optional: false }] },
    ]);
    expect(result[0]!.contributions).toHaveLength(2);
    expect(result[0]!.contributions.map((c) => c.plan_index)).toEqual([0, 1]);
  });
});

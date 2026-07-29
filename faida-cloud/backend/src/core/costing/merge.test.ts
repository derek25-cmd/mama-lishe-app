import { describe, expect, it } from "vitest";
import { mergeIngredients } from "./merge.js";

describe("mergeIngredients", () => {
  it("returns an empty list for no dishes", () => {
    expect(mergeIngredients([])).toEqual([]);
  });

  it("sums shared ingredients across dishes and sorts by id", () => {
    const result = mergeIngredients([
      { recipeId: "pilau_ya_nyama", plates: 60, ingredients: [{ ingredientId: "rice", canonicalQty: 12000 }, { ingredientId: "oil", canonicalQty: 3000 }] },
      { recipeId: "wali_kavu", plates: 20, ingredients: [{ ingredientId: "rice", canonicalQty: 3600 }, { ingredientId: "oil", canonicalQty: 400 }] },
    ]);

    expect(result).toEqual([
      { ingredientId: "oil", canonicalQty: 3400 },
      { ingredientId: "rice", canonicalQty: 15600 },
    ]);
  });
});

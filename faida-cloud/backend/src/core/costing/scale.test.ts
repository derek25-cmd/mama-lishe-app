import { describe, expect, it } from "vitest";
import { scaleRecipe } from "./scale.js";
import { pilauRecipe } from "./__fixtures__/pilau.js";

describe("scaleRecipe", () => {
  it("scales per-base quantities to the requested plate count", () => {
    const result = scaleRecipe(pilauRecipe, { recipeId: "pilau_ya_nyama", plates: 60 });
    expect(result).toEqual({
      recipeId: "pilau_ya_nyama",
      plates: 60,
      ingredients: [
        { ingredientId: "rice", canonicalQty: 12000 },
        { ingredientId: "meat", canonicalQty: 18000 },
        { ingredientId: "oil", canonicalQty: 3000 },
        { ingredientId: "pilau_masala", canonicalQty: 600 },
        { ingredientId: "onion", canonicalQty: 6000 },
      ],
    });
  });

  it("scales down below base plates", () => {
    const result = scaleRecipe(pilauRecipe, { recipeId: "pilau_ya_nyama", plates: 5 });
    expect(result.ingredients[0]).toEqual({ ingredientId: "rice", canonicalQty: 1000 });
  });

  it("rejects a recipe/request id mismatch", () => {
    expect(() => scaleRecipe(pilauRecipe, { recipeId: "wali_kavu", plates: 10 })).toThrow(/recipe mismatch/);
  });

  it("rejects a recipe with non-positive basePlates", () => {
    expect(() =>
      scaleRecipe({ ...pilauRecipe, basePlates: 0 }, { recipeId: "pilau_ya_nyama", plates: 10 }),
    ).toThrow(/invalid basePlates/);
  });

  it("rejects plates below 1", () => {
    expect(() => scaleRecipe(pilauRecipe, { recipeId: "pilau_ya_nyama", plates: 0 })).toThrow(/between 1 and 2000/);
  });

  it("rejects plates above 2000", () => {
    expect(() => scaleRecipe(pilauRecipe, { recipeId: "pilau_ya_nyama", plates: 2001 })).toThrow(/between 1 and 2000/);
  });
});

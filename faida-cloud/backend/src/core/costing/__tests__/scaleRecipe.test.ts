import { describe, expect, it } from "vitest";
import { scaleRecipe } from "../scaleRecipe.js";
import { pilauRecipe } from "./fixtures/data.js";

describe("scaleRecipe", () => {
  it("scales per-base quantities to the requested plate count", () => {
    const result = scaleRecipe(pilauRecipe, 60, 0);
    expect(result).toEqual({
      plan_index: 0,
      recipe_id: "pilau_ya_nyama",
      plates: 60,
      ingredients: [
        { ingredient_id: "rice", qty_g: 12000, is_optional: false },
        { ingredient_id: "meat", qty_g: 18000, is_optional: false },
        { ingredient_id: "oil", qty_g: 3000, is_optional: false },
        { ingredient_id: "pilau_masala", qty_g: 600, is_optional: false },
        { ingredient_id: "onion", qty_g: 6000, is_optional: false },
      ],
    });
  });

  it("scales down below base plates", () => {
    const result = scaleRecipe(pilauRecipe, 1, 0);
    expect(result.ingredients[0]).toEqual({ ingredient_id: "rice", qty_g: 200, is_optional: false });
  });

  it("carries the plan_index through untouched", () => {
    expect(scaleRecipe(pilauRecipe, 10, 7).plan_index).toBe(7);
  });

  it("rejects a recipe with non-positive base_plates", () => {
    expect(() => scaleRecipe({ ...pilauRecipe, base_plates: 0 }, 10, 0)).toThrow(/invalid base_plates/);
  });

  it("rejects plates below 1", () => {
    expect(() => scaleRecipe(pilauRecipe, 0, 0)).toThrow(/plates must be >= 1/);
  });
});

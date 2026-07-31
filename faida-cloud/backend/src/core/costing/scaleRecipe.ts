import type { RecipeInput, ScaledDish } from "./types.js";

// Scale per-base_plates quantities to the plates actually requested.
// Quantities stay floating point here on purpose — rounding is a
// buyability concern that belongs at the unit-conversion step
// (toMarketUnits.ts), never here, and money never appears in this function
// at all.
export function scaleRecipe(recipe: RecipeInput, plates: number, planIndex: number): ScaledDish {
  if (!(recipe.base_plates > 0)) {
    throw new Error(`recipe ${recipe.id} has invalid base_plates ${recipe.base_plates}`);
  }
  if (!(plates >= 1)) {
    throw new Error(`plates must be >= 1, got ${plates}`);
  }

  const factor = plates / recipe.base_plates;
  return {
    plan_index: planIndex,
    recipe_id: recipe.id,
    plates,
    ingredients: recipe.ingredients.map((i) => ({
      ingredient_id: i.ingredient_id,
      qty_g: i.qty_per_base * factor,
      is_optional: i.is_optional,
    })),
  };
}

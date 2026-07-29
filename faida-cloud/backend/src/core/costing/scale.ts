import type { BaseRecipe, DishRequest, ScaledDish } from "./types.js";

// (a) Scale recipe quantities from per-base-plates (DOC 05: base_plates,
// default 10) to the plates a vendor actually requested.
export function scaleRecipe(recipe: BaseRecipe, request: DishRequest): ScaledDish {
  if (recipe.id !== request.recipeId) {
    throw new Error(`recipe mismatch: expected ${request.recipeId}, got ${recipe.id}`);
  }
  if (!(recipe.basePlates > 0)) {
    throw new Error(`recipe ${recipe.id} has invalid basePlates ${recipe.basePlates}`);
  }
  if (!(request.plates >= 1 && request.plates <= 2000)) {
    throw new Error(`plates must be between 1 and 2000, got ${request.plates}`);
  }

  const factor = request.plates / recipe.basePlates;
  return {
    recipeId: recipe.id,
    plates: request.plates,
    ingredients: recipe.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      canonicalQty: i.qtyPerBase * factor,
    })),
  };
}

import type { MergedIngredient, ScaledDish } from "./types.js";

// (b) Merge shared ingredients across multiple dishes into one shopping list
// line per ingredient, so a vendor cooking Pilau + Wali doesn't buy rice twice.
export function mergeIngredients(dishes: ScaledDish[]): MergedIngredient[] {
  const totals = new Map<string, number>();

  for (const dish of dishes) {
    for (const ing of dish.ingredients) {
      totals.set(ing.ingredientId, (totals.get(ing.ingredientId) ?? 0) + ing.canonicalQty);
    }
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ingredientId, canonicalQty]) => ({ ingredientId, canonicalQty }));
}

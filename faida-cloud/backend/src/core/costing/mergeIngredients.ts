import type { ScaledDish, MergedLine } from "./types.js";

// Sum quantities of the same ingredient across every dish in the plan (a
// plan with pilau and beans buys onions once), while keeping a record of
// which dish contributed how much — that per-dish breakdown is the weight
// costPlan.ts uses later to apportion the merged line's final cost back
// across the dishes that share it.
export function mergeIngredients(scaledDishes: ScaledDish[]): MergedLine[] {
  const byIngredient = new Map<string, MergedLine>();

  for (const dish of scaledDishes) {
    for (const ing of dish.ingredients) {
      let line = byIngredient.get(ing.ingredient_id);
      if (!line) {
        line = { ingredient_id: ing.ingredient_id, total_qty_g: 0, contributions: [] };
        byIngredient.set(ing.ingredient_id, line);
      }
      line.total_qty_g += ing.qty_g;
      line.contributions.push({
        plan_index: dish.plan_index,
        recipe_id: dish.recipe_id,
        qty_g: ing.qty_g,
        plates: dish.plates,
      });
    }
  }

  return [...byIngredient.values()].sort((a, b) => a.ingredient_id.localeCompare(b.ingredient_id));
}

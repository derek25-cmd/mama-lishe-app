import { scaleRecipe } from "./scale.js";
import { mergeIngredients } from "./merge.js";
import { priceIngredients } from "./price.js";
import { convertToBuyable } from "./units.js";
import { computeMargin } from "./margin.js";
import type {
  BaseRecipe,
  BuyableIngredient,
  Confidence,
  DishRequest,
  Ingredient,
  InformalUnit,
  MarketPriceSnapshot,
} from "./types.js";

export * from "./types.js";
export { scaleRecipe } from "./scale.js";
export { mergeIngredients } from "./merge.js";
export { priceIngredients } from "./price.js";
export { convertToBuyable } from "./units.js";
export { computeMargin } from "./margin.js";

export interface PriceCookPlanInput {
  dishes: DishRequest[];
  recipes: Record<string, BaseRecipe>;
  ingredients: Record<string, Ingredient>;
  informalUnits: Record<string, InformalUnit>;
  priceSnapshot: MarketPriceSnapshot;
  targetMarginPct: number;
}

export interface ShoppingListLine extends BuyableIngredient {
  pricePerKgTzs: number;
  confidence: Confidence;
  source: "market" | "region_average" | "forecast";
  costTzs: number;
}

export interface DishCost {
  recipeId: string;
  plates: number;
  costTzs: number;
  costPerPlateTzs: number;
  recommendedPriceTzs: number;
}

export interface PriceCookPlanOutput {
  shoppingList: ShoppingListLine[];
  totalCostTzs: number;
  dishes: DishCost[];
}

// Full pipeline: scale each requested dish, merge shared ingredients into one
// shopping list, round each merged line up to a buyable unit, price the
// *bought* quantity (not the raw recipe need — you pay for the whole bag),
// then allocate that cost back to each dish (proportional to its own raw
// share of each ingredient) to compute per-dish cost/plate and price.
export function priceCookPlan(input: PriceCookPlanInput): PriceCookPlanOutput {
  const scaledDishes = input.dishes.map((d) => {
    const recipe = input.recipes[d.recipeId];
    if (!recipe) throw new Error(`unknown recipe ${d.recipeId}`);
    return scaleRecipe(recipe, d);
  });

  const merged = mergeIngredients(scaledDishes);
  const totalPlates = input.dishes.reduce((n, d) => n + d.plates, 0);

  const buyables = merged.map((m) => {
    const ingredient = input.ingredients[m.ingredientId];
    if (!ingredient) throw new Error(`unknown ingredient ${m.ingredientId}`);
    return convertToBuyable(ingredient, m, totalPlates, input.informalUnits[m.ingredientId]);
  });

  const priced = priceIngredients(
    buyables.map((b) => ({ ingredientId: b.ingredientId, qty: b.roundedQty })),
    input.priceSnapshot,
  );
  const pricedById = new Map(priced.map((p) => [p.ingredientId, p]));

  const shoppingList: ShoppingListLine[] = buyables.map((b) => {
    const p = pricedById.get(b.ingredientId)!;
    return { ...b, pricePerKgTzs: p.pricePerKgTzs, confidence: p.confidence, source: p.source, costTzs: p.costTzs };
  });

  const totalCostTzs = shoppingList.reduce((n, line) => n + line.costTzs, 0);

  const dishes: DishCost[] = scaledDishes.map((dish) => {
    let dishCostTzs = 0;
    for (const ing of dish.ingredients) {
      const mergedQty = merged.find((m) => m.ingredientId === ing.ingredientId)!.canonicalQty;
      const p = pricedById.get(ing.ingredientId)!;
      const share = ing.canonicalQty / mergedQty;
      dishCostTzs += Math.ceil(p.costTzs * share);
    }
    const margin = computeMargin(dishCostTzs, dish.plates, input.targetMarginPct);
    return {
      recipeId: dish.recipeId,
      plates: dish.plates,
      costTzs: dishCostTzs,
      costPerPlateTzs: margin.costPerPlateTzs,
      recommendedPriceTzs: margin.recommendedPriceTzs,
    };
  });

  return { shoppingList, totalCostTzs, dishes };
}

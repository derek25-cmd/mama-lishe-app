// Costing core — shared types. Pure data, no I/O.

export type CanonicalUnit = "g" | "ml";

// Matches ref.ingredients.category check constraint's documented values.
export type IngredientCategory =
  | "nafaka" // grains/beans -> 0.5 kg buyability steps
  | "mboga" // vegetables -> whole informal units
  | "nyama" // meat -> 0.25 kg buyability steps
  | "viungo" // spices -> fixed per-plate allowance
  | "mafuta" // oil -> standard bottle sizes
  | "nyingine"; // other/fallback -> whole informal units

export type Confidence = "high" | "medium" | "low" | "forecast";

export interface Ingredient {
  id: string;
  category: IngredientCategory;
  canonicalUnit: CanonicalUnit;
}

export interface RecipeIngredient {
  ingredientId: string;
  qtyPerBase: number; // canonical grams/ml per basePlates
}

export interface BaseRecipe {
  id: string;
  basePlates: number;
  ingredients: RecipeIngredient[];
}

export interface DishRequest {
  recipeId: string;
  plates: number;
}

export interface ScaledIngredient {
  ingredientId: string;
  canonicalQty: number; // grams or ml, scaled to requested plates
}

export interface ScaledDish {
  recipeId: string;
  plates: number;
  ingredients: ScaledIngredient[];
}

export interface MergedIngredient {
  ingredientId: string;
  canonicalQty: number;
}

// A caller-supplied snapshot for one target market. regionAverage and forecast
// are precomputed by the caller (DB layer) for the ingredients that need them —
// this module does no aggregation across vendors/markets itself.
export interface MarketPriceSnapshot {
  market: Record<string, { pricePerKgTzs: number; confidence: Confidence }>;
  regionAverage: Record<string, number>; // ingredientId -> avg price/kg TZS
  forecast: Record<string, number>; // ingredientId -> forecast price/kg TZS
}

// Generic "quantity to price" — the orchestrator feeds this the *buyable*
// (post-rounding) quantity, not the raw recipe need, so cost reflects what a
// vendor actually pays for.
export interface PricingInput {
  ingredientId: string;
  qty: number; // canonical unit (g/ml)
}

export interface PricedIngredient {
  ingredientId: string;
  qty: number;
  pricePerKgTzs: number;
  confidence: Confidence;
  source: "market" | "region_average" | "forecast";
  costTzs: number; // integer TZS
}

export interface InformalUnit {
  unitNameSw: string;
  gramsPerUnit: number;
}

export interface BottleBreakdown {
  sizeMl: number;
  count: number;
}

export interface BuyableIngredient {
  ingredientId: string;
  canonicalQty: number;
  roundedQty: number; // canonical unit, after buyability rounding
  displayUnit: string;
  displayQty: number;
  bottles?: BottleBreakdown[]; // present only for category 'mafuta'
}

export interface MarginResult {
  costPerPlateTzs: number;
  recommendedPriceTzs: number;
}

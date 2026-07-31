// Costing engine — closed type contract. This module has zero I/O; every
// shape a pure function accepts or returns lives here so scaleRecipe.ts,
// mergeIngredients.ts, priceIngredients.ts, toMarketUnits.ts,
// computeMargins.ts and costPlan.ts can import types only, never each
// other's internals.

// ---------- branded money ----------

declare const TZS_BRAND: unique symbol;
/** Integer Tanzanian Shillings. Never a float — see tzs() below. */
export type TZS = number & { readonly [TZS_BRAND]: true };

/** The only legal way to produce a TZS value. Throws on any non-integer. */
export function tzs(value: number): TZS {
  if (!Number.isInteger(value)) {
    throw new Error(`TZS must be an integer, got ${value}`);
  }
  return value as TZS;
}

// ---------- inputs ----------

export interface RecipeIngredientInput {
  ingredient_id: string;
  qty_per_base: number; // canonical grams/ml per base_plates
  is_optional: boolean;
}

export interface RecipeInput {
  id: string;
  name_sw: string;
  base_plates: number;
  ingredients: RecipeIngredientInput[];
}

export interface PlanItem {
  recipe: RecipeInput;
  plates: number;
}

export interface PlanRequest {
  items: PlanItem[];
  target_margin_pct: number;
}

export type Confidence = "high" | "medium" | "low" | "forecast";
export type PriceConfidence = Confidence | "none";

export interface PriceEntry {
  price_per_kg_tzs: TZS;
  confidence: Confidence;
  week_start: string; // ISO date, Monday of the priced week
}

/** ingredient_id -> price entry. Same shape for the vendor's own market,
 * the region average, and the forecast table — the repository layer is
 * responsible for tagging each entry's `confidence` correctly before it
 * ever reaches the pure core (e.g. region-average entries as 'low',
 * forecast entries as 'forecast'); priceIngredients trusts whatever
 * confidence a resolved entry carries rather than re-deriving it. */
export type PriceSnapshot = Record<string, PriceEntry>;

export interface UnitOption {
  unit_name_sw: string;
  grams_per_unit: number;
}

/** ingredient_id -> every market unit it can be bought in (fungu, kopo,
 * sado, debe, kiroba, kilo, lita, ...). Ignored entirely for ingredients
 * whose category has a fixed buyability rule (nafaka/nyama/mafuta/viungo). */
export type UnitTable = Record<string, UnitOption[]>;

export type IngredientCategory = "nafaka" | "mboga" | "nyama" | "viungo" | "mafuta" | "nyingine";

export interface IngredientMetaEntry {
  name_sw: string;
  category: IngredientCategory;
  canonical_unit: "g" | "ml";
}

/** ingredient_id -> reference metadata. */
export type IngredientMeta = Record<string, IngredientMetaEntry>;

// ---------- internal pipeline shapes (scaleRecipe -> mergeIngredients -> priceIngredients -> toMarketUnits) ----------

export interface ScaledIngredient {
  ingredient_id: string;
  qty_g: number;
  is_optional: boolean;
}

export interface ScaledDish {
  /** Position in the plan's items array — the real join key for
   * apportionment. recipe_id alone would collide if a plan ever listed the
   * same recipe twice as separate line items. */
  plan_index: number;
  recipe_id: string;
  plates: number;
  ingredients: ScaledIngredient[];
}

/** How much of a merged ingredient line one specific dish contributed, in
 * raw (pre-rounding) grams — the weight used to apportion that line's
 * final cost back across the dishes that share it. */
export interface DishContribution {
  plan_index: number;
  recipe_id: string;
  qty_g: number;
  /** The contributing dish's own plate count — carried through so
   * toMarketUnits can compute the viungo (spice) fixed per-plate TZS
   * allowance without needing its own plates parameter; summing this
   * across a line's contributions gives "plates across every dish that
   * uses this ingredient", which is what the allowance is per. */
  plates: number;
}

export interface MergedLine {
  ingredient_id: string;
  total_qty_g: number;
  contributions: DishContribution[];
}

export interface PricedLine extends MergedLine {
  price_per_kg_tzs: TZS;
  confidence: PriceConfidence;
  is_estimate: boolean;
}

// ---------- outputs ----------

export interface ShoppingLine {
  ingredient_id: string;
  name_sw: string;
  qty_canonical_g: number; // the raw (pre-rounding) requirement
  display_qty: number; // the rounded, purchasable quantity in display_unit
  display_unit: string;
  unit_price_tzs: TZS; // price per kg used to cost this line
  line_cost_tzs: TZS; // computed from the ROUNDED quantity, not the raw requirement
  price_confidence: PriceConfidence;
  is_estimate: boolean;
}

export interface DishCosting {
  recipe_id: string;
  plates: number;
  dish_cost_tzs: TZS;
  cost_per_plate_tzs: TZS;
  recommended_price_tzs: TZS;
  achieved_margin_pct: number;
}

export type WarningCode = "MISSING_PRICE" | "STALE_PRICE";

export interface CostingWarning {
  code: WarningCode;
  ingredient_id?: string;
  message: string;
}

export interface CostingResult {
  lines: ShoppingLine[];
  dishes: DishCosting[];
  total_cost_tzs: TZS;
  price_week: string | null;
  warnings: CostingWarning[];
}

/** Everything costPlan needs beyond the request itself — the impure
 * repository layer (Task 4) resolves all of this before calling in. */
export interface CostingData {
  priceSnapshot: PriceSnapshot;
  regionSnapshot: PriceSnapshot;
  forecastSnapshot: PriceSnapshot;
  unitTable: UnitTable;
  ingredientMeta: IngredientMeta;
}

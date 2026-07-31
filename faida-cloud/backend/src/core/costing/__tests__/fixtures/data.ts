import { tzs, type IngredientMeta, type PriceSnapshot, type RecipeInput, type UnitTable } from "../../types.js";

// Shared fixture data for costing engine tests. Values are invented but
// internally consistent. See __tests__/hand-verification.md for the
// by-hand arithmetic these were checked against before any golden file
// was generated.

export const ingredientMeta: IngredientMeta = {
  rice: { name_sw: "Mchele", category: "nafaka", canonical_unit: "g" },
  meat: { name_sw: "Nyama ya ng'ombe", category: "nyama", canonical_unit: "g" },
  oil: { name_sw: "Mafuta ya kupikia", category: "mafuta", canonical_unit: "ml" },
  pilau_masala: { name_sw: "Viungo vya pilau", category: "viungo", canonical_unit: "g" },
  onion: { name_sw: "Vitunguu", category: "mboga", canonical_unit: "g" },
  beans: { name_sw: "Maharage", category: "nafaka", canonical_unit: "g" },
  cabbage: { name_sw: "Kabichi", category: "mboga", canonical_unit: "g" },
};

export const unitTable: UnitTable = {
  onion: [
    { unit_name_sw: "fungu", grams_per_unit: 250 },
    { unit_name_sw: "kilo", grams_per_unit: 1000 },
  ],
  cabbage: [
    { unit_name_sw: "kichwa", grams_per_unit: 900 },
    { unit_name_sw: "kilo", grams_per_unit: 1000 },
  ],
};

export const pilauRecipe: RecipeInput = {
  id: "pilau_ya_nyama",
  name_sw: "Pilau ya nyama",
  base_plates: 10,
  ingredients: [
    { ingredient_id: "rice", qty_per_base: 2000, is_optional: false },
    { ingredient_id: "meat", qty_per_base: 3000, is_optional: false },
    { ingredient_id: "oil", qty_per_base: 500, is_optional: false },
    { ingredient_id: "pilau_masala", qty_per_base: 100, is_optional: false },
    { ingredient_id: "onion", qty_per_base: 1000, is_optional: false },
  ],
};

export const waliMaharageRecipe: RecipeInput = {
  id: "wali_maharage",
  name_sw: "Wali maharage",
  base_plates: 10,
  ingredients: [
    { ingredient_id: "rice", qty_per_base: 1500, is_optional: false },
    { ingredient_id: "beans", qty_per_base: 1000, is_optional: false },
    { ingredient_id: "oil", qty_per_base: 200, is_optional: false },
  ],
};

const WEEK_START = "2026-08-04";

export const marketSnapshot: PriceSnapshot = {
  rice: { price_per_kg_tzs: tzs(2800), confidence: "high", week_start: WEEK_START },
  meat: { price_per_kg_tzs: tzs(12000), confidence: "high", week_start: WEEK_START },
  oil: { price_per_kg_tzs: tzs(6500), confidence: "high", week_start: WEEK_START },
  pilau_masala: { price_per_kg_tzs: tzs(8000), confidence: "high", week_start: WEEK_START },
  onion: { price_per_kg_tzs: tzs(1500), confidence: "high", week_start: WEEK_START },
  beans: { price_per_kg_tzs: tzs(3200), confidence: "high", week_start: WEEK_START },
};

export const regionSnapshot: PriceSnapshot = {
  cabbage: { price_per_kg_tzs: tzs(1200), confidence: "low", week_start: WEEK_START },
};

export const forecastSnapshot: PriceSnapshot = {
  cabbage: { price_per_kg_tzs: tzs(1300), confidence: "forecast", week_start: WEEK_START },
};

export const emptySnapshot: PriceSnapshot = {};

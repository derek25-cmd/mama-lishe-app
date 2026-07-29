import type { BaseRecipe, Ingredient, InformalUnit, MarketPriceSnapshot } from "../types.js";

// Shared fixtures for costing core golden-file tests. Values are invented
// but internally consistent (a full Pilau ya Nyama recipe, 10-plate base).

export const ingredients: Record<string, Ingredient> = {
  rice: { id: "rice", category: "nafaka", canonicalUnit: "g" },
  meat: { id: "meat", category: "nyama", canonicalUnit: "g" },
  oil: { id: "oil", category: "mafuta", canonicalUnit: "ml" },
  pilau_masala: { id: "pilau_masala", category: "viungo", canonicalUnit: "g" },
  onion: { id: "onion", category: "mboga", canonicalUnit: "g" },
  cabbage: { id: "cabbage", category: "mboga", canonicalUnit: "g" },
};

export const informalUnits: Record<string, InformalUnit> = {
  onion: { unitNameSw: "fungu", gramsPerUnit: 250 },
  cabbage: { unitNameSw: "kichwa", gramsPerUnit: 900 },
};

export const pilauRecipe: BaseRecipe = {
  id: "pilau_ya_nyama",
  basePlates: 10,
  ingredients: [
    { ingredientId: "rice", qtyPerBase: 2000 },
    { ingredientId: "meat", qtyPerBase: 3000 },
    { ingredientId: "oil", qtyPerBase: 500 },
    { ingredientId: "pilau_masala", qtyPerBase: 100 },
    { ingredientId: "onion", qtyPerBase: 1000 },
  ],
};

export const waliRecipe: BaseRecipe = {
  id: "wali_kavu",
  basePlates: 10,
  ingredients: [
    { ingredientId: "rice", qtyPerBase: 1800 },
    { ingredientId: "oil", qtyPerBase: 200 },
  ],
};

export const recipes: Record<string, BaseRecipe> = {
  pilau_ya_nyama: pilauRecipe,
  wali_kavu: waliRecipe,
};

export const buguruniSnapshot: MarketPriceSnapshot = {
  market: {
    rice: { pricePerKgTzs: 2800, confidence: "high" },
    meat: { pricePerKgTzs: 12000, confidence: "high" },
    oil: { pricePerKgTzs: 6500, confidence: "medium" },
    pilau_masala: { pricePerKgTzs: 8000, confidence: "medium" },
    onion: { pricePerKgTzs: 1500, confidence: "high" },
  },
  regionAverage: {
    cabbage: 1200,
  },
  forecast: {
    cabbage: 1300,
  },
};

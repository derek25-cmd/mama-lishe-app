import { describe, expect, it } from "vitest";
import { convertToBuyable } from "./units.js";
import type { Ingredient, InformalUnit } from "./types.js";

const rice: Ingredient = { id: "rice", category: "nafaka", canonicalUnit: "g" };
const meat: Ingredient = { id: "meat", category: "nyama", canonicalUnit: "g" };
const oil: Ingredient = { id: "oil", category: "mafuta", canonicalUnit: "ml" };
const masala: Ingredient = { id: "pilau_masala", category: "viungo", canonicalUnit: "g" };
const onion: Ingredient = { id: "onion", category: "mboga", canonicalUnit: "g" };
const misc: Ingredient = { id: "misc", category: "nyingine", canonicalUnit: "g" };
const onionUnit: InformalUnit = { unitNameSw: "fungu", gramsPerUnit: 250 };

describe("convertToBuyable", () => {
  it("rejects an ingredient/merged-line mismatch", () => {
    expect(() => convertToBuyable(rice, { ingredientId: "meat", canonicalQty: 100 }, 10)).toThrow(/ingredient mismatch/);
  });

  it("nafaka: rounds up to 0.5 kg steps, exact fit unchanged", () => {
    expect(convertToBuyable(rice, { ingredientId: "rice", canonicalQty: 5000 }, 10)).toEqual({
      ingredientId: "rice",
      canonicalQty: 5000,
      roundedQty: 5000,
      displayUnit: "kg",
      displayQty: 5,
    });
  });

  it("nafaka: rounds a remainder up to the next 0.5 kg step", () => {
    expect(convertToBuyable(rice, { ingredientId: "rice", canonicalQty: 5001 }, 10)).toEqual({
      ingredientId: "rice",
      canonicalQty: 5001,
      roundedQty: 5500,
      displayUnit: "kg",
      displayQty: 5.5,
    });
  });

  it("nyama: rounds up to 0.25 kg steps", () => {
    expect(convertToBuyable(meat, { ingredientId: "meat", canonicalQty: 4501 }, 10)).toEqual({
      ingredientId: "meat",
      canonicalQty: 4501,
      roundedQty: 4750,
      displayUnit: "kg",
      displayQty: 4.75,
    });
  });

  it("mafuta: packs exact multiples of standard bottle sizes with no remainder", () => {
    const result = convertToBuyable(oil, { ingredientId: "oil", canonicalQty: 3000 }, 10);
    expect(result).toEqual({
      ingredientId: "oil",
      canonicalQty: 3000,
      roundedQty: 3000,
      displayUnit: "chupa",
      displayQty: 2,
      bottles: [
        { sizeMl: 2000, count: 1 },
        { sizeMl: 1000, count: 1 },
      ],
    });
  });

  it("mafuta: a remainder opens a new smallest-bottle bucket", () => {
    const result = convertToBuyable(oil, { ingredientId: "oil", canonicalQty: 2300 }, 10);
    expect(result.bottles).toEqual([
      { sizeMl: 2000, count: 1 },
      { sizeMl: 500, count: 1 },
    ]);
    expect(result.roundedQty).toBe(2500);
  });

  it("mafuta: a remainder adds to an already-open smallest-bottle bucket", () => {
    const result = convertToBuyable(oil, { ingredientId: "oil", canonicalQty: 5750 }, 10);
    expect(result.bottles).toEqual([
      { sizeMl: 5000, count: 1 },
      { sizeMl: 500, count: 2 },
    ]);
    expect(result.roundedQty).toBe(6000);
  });

  it("viungo: uses a fixed per-plate allowance, ignoring the recipe's raw qty", () => {
    expect(convertToBuyable(masala, { ingredientId: "pilau_masala", canonicalQty: 999 }, 60)).toEqual({
      ingredientId: "pilau_masala",
      canonicalQty: 999,
      roundedQty: 300,
      displayUnit: "kiasi",
      displayQty: 1,
    });
  });

  it("mboga: rounds up to whole informal units", () => {
    expect(convertToBuyable(onion, { ingredientId: "onion", canonicalQty: 501 }, 10, onionUnit)).toEqual({
      ingredientId: "onion",
      canonicalQty: 501,
      roundedQty: 750,
      displayUnit: "fungu",
      displayQty: 3,
    });
  });

  it("other: same whole-unit rounding as mboga", () => {
    expect(convertToBuyable(misc, { ingredientId: "misc", canonicalQty: 100 }, 10, { unitNameSw: "kopo", gramsPerUnit: 100 })).toEqual({
      ingredientId: "misc",
      canonicalQty: 100,
      roundedQty: 100,
      displayUnit: "kopo",
      displayQty: 1,
    });
  });

  it("mboga/other: throws when no informal unit is supplied", () => {
    expect(() => convertToBuyable(onion, { ingredientId: "onion", canonicalQty: 500 }, 10)).toThrow(/needs an informal unit/);
  });
});

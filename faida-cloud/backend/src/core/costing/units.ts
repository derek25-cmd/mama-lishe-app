import type {
  BottleBreakdown,
  BuyableIngredient,
  Ingredient,
  InformalUnit,
  MergedIngredient,
} from "./types.js";

// (d) Convert canonical grams/ml to informal, buyable units. Street markets
// don't sell exact grams — vendors buy in units that round up (you can't buy
// 0.4 of a fungu), so every rule below rounds toward "enough", never short.
const GRAIN_BEAN_STEP_G = 500; // nafaka: 0.5 kg steps
const MEAT_STEP_G = 250; // nyama: 0.25 kg steps
const OIL_BOTTLE_SIZES_ML = [5000, 2000, 1000, 500] as const; // mafuta: standard bottles, largest first
const SPICE_ALLOWANCE_G_PER_PLATE = 5; // viungo: flat allowance, not the recipe's computed qty

function ceilToStep(qty: number, step: number): number {
  return Math.ceil(qty / step) * step;
}

function packBottles(ml: number): { bottles: BottleBreakdown[]; totalMl: number } {
  let remaining = Math.ceil(ml);
  const bottles: BottleBreakdown[] = [];

  for (const size of OIL_BOTTLE_SIZES_ML) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / size);
    if (count > 0) {
      bottles.push({ sizeMl: size, count });
      remaining -= count * size;
    }
  }
  if (remaining > 0) {
    const smallest = OIL_BOTTLE_SIZES_ML[OIL_BOTTLE_SIZES_ML.length - 1]!;
    const existing = bottles.find((b) => b.sizeMl === smallest);
    if (existing) {
      existing.count += 1;
    } else {
      bottles.push({ sizeMl: smallest, count: 1 });
    }
  }

  const totalMl = bottles.reduce((sum, b) => sum + b.sizeMl * b.count, 0);
  return { bottles, totalMl };
}

export function convertToBuyable(
  ingredient: Ingredient,
  merged: MergedIngredient,
  plates: number,
  informalUnit?: InformalUnit,
): BuyableIngredient {
  if (ingredient.id !== merged.ingredientId) {
    throw new Error(`ingredient mismatch: expected ${merged.ingredientId}, got ${ingredient.id}`);
  }

  switch (ingredient.category) {
    case "nafaka": {
      const roundedQty = ceilToStep(merged.canonicalQty, GRAIN_BEAN_STEP_G);
      return {
        ingredientId: ingredient.id,
        canonicalQty: merged.canonicalQty,
        roundedQty,
        displayUnit: "kg",
        displayQty: roundedQty / 1000,
      };
    }
    case "nyama": {
      const roundedQty = ceilToStep(merged.canonicalQty, MEAT_STEP_G);
      return {
        ingredientId: ingredient.id,
        canonicalQty: merged.canonicalQty,
        roundedQty,
        displayUnit: "kg",
        displayQty: roundedQty / 1000,
      };
    }
    case "mafuta": {
      const { bottles, totalMl } = packBottles(merged.canonicalQty);
      return {
        ingredientId: ingredient.id,
        canonicalQty: merged.canonicalQty,
        roundedQty: totalMl,
        displayUnit: "chupa",
        displayQty: bottles.reduce((n, b) => n + b.count, 0),
        bottles,
      };
    }
    case "viungo": {
      const roundedQty = SPICE_ALLOWANCE_G_PER_PLATE * plates;
      return {
        ingredientId: ingredient.id,
        canonicalQty: merged.canonicalQty,
        roundedQty,
        displayUnit: "kiasi",
        displayQty: 1,
      };
    }
    case "mboga":
    case "nyingine":
    default: {
      if (!informalUnit) {
        throw new Error(`ingredient ${ingredient.id} (category ${ingredient.category}) needs an informal unit`);
      }
      const units = Math.ceil(merged.canonicalQty / informalUnit.gramsPerUnit);
      return {
        ingredientId: ingredient.id,
        canonicalQty: merged.canonicalQty,
        roundedQty: units * informalUnit.gramsPerUnit,
        displayUnit: informalUnit.unitNameSw,
        displayQty: units,
      };
    }
  }
}

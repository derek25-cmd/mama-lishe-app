import type { PricedLine, UnitTable, IngredientMeta, ShoppingLine, UnitOption } from "./types.js";
import { tzs } from "./types.js";

// Buyability rules — field reality, not negotiable (per DOC 02 §5.3).
const GRAIN_BEAN_FLOUR_STEP_G = 500; // nafaka: 0.5 kg steps
const MEAT_FISH_STEP_G = 250; // nyama: 0.25 kg steps
const OIL_BOTTLE_SIZES_ML = [5000, 3000, 2000, 1000, 500] as const; // mafuta, largest first for packing
/** Fixed per-plate allowance for viungo (spices/low-value seasonings), in
 * TZS — bypasses weight/price entirely by design. Documented default;
 * override by passing a different value if this ever needs to be
 * market-configurable. */
export const DEFAULT_SPICE_ALLOWANCE_TZS_PER_PLATE = 200;

const INFORMAL_UNIT_OVERAGE_TOLERANCE = 0.2; // 20%
const MAX_LARGEST_INFORMAL_UNITS_BEFORE_KILO_SWITCH = 4;

function ceilToStep(qtyG: number, stepG: number): number {
  return Math.ceil(qtyG / stepG) * stepG;
}

// Greedy, largest-size-first: minimizes total purchased volume (and so
// cost) across the available sizes — that's the number that matters for
// "trust these numbers." It does not additionally minimize bottle count
// when two combinations tie on volume (e.g. 990ml packs as two 500ml
// bottles rather than a single 1L bottle, both 1000ml total) — a cosmetic
// difference in the bottle count shown, never in what she pays.
function packBottles(ml: number): { totalMl: number; count: number } {
  let remaining = Math.ceil(ml);
  const bottles: { sizeMl: number; count: number }[] = [];
  for (const size of OIL_BOTTLE_SIZES_ML) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / size);
    if (count > 0) {
      bottles.push({ sizeMl: size, count });
      remaining -= count * size;
    }
  }
  if (remaining > 0) {
    const smallest = OIL_BOTTLE_SIZES_ML[OIL_BOTTLE_SIZES_ML.length - 1];
    const existing = bottles.find((b) => b.sizeMl === smallest);
    if (existing) existing.count += 1;
    else bottles.push({ sizeMl: smallest, count: 1 });
  }
  const totalMl = bottles.reduce((sum, b) => sum + b.sizeMl * b.count, 0);
  const count = bottles.reduce((sum, b) => sum + b.count, 0);
  return { totalMl, count };
}

// Prefer the smallest informal unit (fungu, kopo, sado, debe, kiroba, ...)
// whose whole-multiple lands within 20% over the requirement — buying a
// debe for a 100g need would waste far more than that. If the requirement
// would take more than 4 of the *largest* informal unit, switch to buying
// by the kilo instead (nobody buys 6 debes; they buy kilos at that point).
// If nothing is within the 20% tolerance (the requirement is smaller than
// even the smallest unit can tightly satisfy), fall back to one of the
// smallest unit — the minimum purchasable amount.
function pickInformalUnit(qtyG: number, units: UnitOption[]): { unit: UnitOption; count: number } {
  const informal = units.filter((u) => u.unit_name_sw !== "kilo").sort((a, b) => a.grams_per_unit - b.grams_per_unit);
  const kilo = units.find((u) => u.unit_name_sw === "kilo");
  const largestInformal = informal[informal.length - 1];

  if (kilo && largestInformal && qtyG > MAX_LARGEST_INFORMAL_UNITS_BEFORE_KILO_SWITCH * largestInformal.grams_per_unit) {
    return { unit: kilo, count: Math.ceil(qtyG / kilo.grams_per_unit) };
  }

  for (const u of informal) {
    const count = Math.ceil(qtyG / u.grams_per_unit);
    const overage = (count * u.grams_per_unit - qtyG) / qtyG;
    if (overage <= INFORMAL_UNIT_OVERAGE_TOLERANCE) {
      return { unit: u, count };
    }
  }

  if (informal.length > 0) {
    const smallest = informal[0]!;
    return { unit: smallest, count: Math.ceil(qtyG / smallest.grams_per_unit) };
  }
  // informal is empty, so — given the caller already guarantees `units` is
  // non-empty — kilo must be the only unit present.
  return { unit: kilo!, count: Math.ceil(qtyG / kilo!.grams_per_unit) };
}

// Converts a priced, merged line into what a vendor actually buys. Because
// rounding up is applied, line_cost_tzs is always computed from the
// rounded, purchasable quantity — she pays for the whole bag, not the
// theoretical requirement.
export function toMarketUnits(
  line: PricedLine,
  unitTable: UnitTable,
  meta: IngredientMeta,
  spiceAllowanceTzsPerPlate: number = DEFAULT_SPICE_ALLOWANCE_TZS_PER_PLATE,
): ShoppingLine {
  const ingredientMeta = meta[line.ingredient_id];
  if (!ingredientMeta) throw new Error(`no ingredient metadata for ${line.ingredient_id}`);

  const pricePerKg = line.price_per_kg_tzs;
  let displayQty: number;
  let displayUnit: string;
  let lineCostTzs: number;

  switch (ingredientMeta.category) {
    case "nafaka": {
      const roundedG = ceilToStep(line.total_qty_g, GRAIN_BEAN_FLOUR_STEP_G);
      displayUnit = "kg";
      displayQty = roundedG / 1000;
      lineCostTzs = Math.ceil((roundedG / 1000) * pricePerKg);
      break;
    }
    case "nyama": {
      const roundedG = ceilToStep(line.total_qty_g, MEAT_FISH_STEP_G);
      displayUnit = "kg";
      displayQty = roundedG / 1000;
      lineCostTzs = Math.ceil((roundedG / 1000) * pricePerKg);
      break;
    }
    case "mafuta": {
      const { totalMl, count } = packBottles(line.total_qty_g);
      displayUnit = "chupa";
      displayQty = count;
      lineCostTzs = Math.ceil((totalMl / 1000) * pricePerKg);
      break;
    }
    case "viungo": {
      // Bypasses weight and market price entirely — a flat allowance per
      // plate across every dish that uses this spice.
      const totalPlates = line.contributions.reduce((sum, c) => sum + c.plates, 0);
      displayUnit = "kiasi";
      displayQty = 1;
      lineCostTzs = spiceAllowanceTzsPerPlate * totalPlates;
      break;
    }
    case "mboga":
    case "nyingine":
    default: {
      const units = unitTable[line.ingredient_id];
      if (!units || units.length === 0) throw new Error(`no market units for ${line.ingredient_id}`);
      const { unit, count } = pickInformalUnit(line.total_qty_g, units);
      const roundedG = count * unit.grams_per_unit;
      displayUnit = unit.unit_name_sw;
      displayQty = count;
      lineCostTzs = Math.ceil((roundedG / 1000) * pricePerKg);
      break;
    }
  }

  return {
    ingredient_id: line.ingredient_id,
    name_sw: ingredientMeta.name_sw,
    qty_canonical_g: line.total_qty_g,
    display_qty: displayQty,
    display_unit: displayUnit,
    unit_price_tzs: pricePerKg,
    line_cost_tzs: tzs(lineCostTzs),
    price_confidence: line.confidence,
    is_estimate: line.is_estimate,
  };
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { toMarketUnits } from "../toMarketUnits.js";
import type { PricedLine } from "../types.js";
import { tzs } from "../types.js";
import { ingredientMeta, unitTable, marketSnapshot } from "./fixtures/data.js";

const dir = dirname(fileURLToPath(import.meta.url));
function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, "golden", name), "utf8"));
}

function priced(id: string, qtyG: number, plates = 10): PricedLine {
  const entry = marketSnapshot[id]!;
  return {
    ingredient_id: id,
    total_qty_g: qtyG,
    contributions: [{ plan_index: 0, recipe_id: "r", qty_g: qtyG, plates }],
    price_per_kg_tzs: entry.price_per_kg_tzs,
    confidence: "high",
    is_estimate: false,
  };
}

describe("toMarketUnits — rounding rule boundaries (just below / just above)", () => {
  it("matches the hand-verified golden thresholds byte for byte", () => {
    const result = {
      fungu_just_below_2: toMarketUnits(priced("onion", 497.5), unitTable, ingredientMeta),
      fungu_just_above_2: toMarketUnits(priced("onion", 502.5), unitTable, ingredientMeta),
      meat_just_below_step: toMarketUnits(priced("meat", 249), unitTable, ingredientMeta),
      meat_just_above_step: toMarketUnits(priced("meat", 260), unitTable, ingredientMeta),
      rice_just_below_step: toMarketUnits(priced("rice", 490), unitTable, ingredientMeta),
      rice_just_above_step: toMarketUnits(priced("rice", 510), unitTable, ingredientMeta),
      oil_just_below_1L: toMarketUnits(priced("oil", 1000), unitTable, ingredientMeta),
      oil_just_above_1L: toMarketUnits(priced("oil", 1010), unitTable, ingredientMeta),
      onion_just_below_kilo_switch: toMarketUnits(priced("onion", 995), unitTable, ingredientMeta),
      onion_just_above_kilo_switch: toMarketUnits(priced("onion", 1005), unitTable, ingredientMeta),
    };
    expect(result).toEqual(golden("rounding-thresholds.json"));
  });
});

describe("toMarketUnits — spice (viungo) fixed per-plate allowance", () => {
  it("bypasses weight/price entirely — allowance x total plates across contributing dishes", () => {
    const result = {
      single_dish_60_plates: toMarketUnits(
        {
          ingredient_id: "pilau_masala",
          total_qty_g: 600,
          contributions: [{ plan_index: 0, recipe_id: "pilau_ya_nyama", qty_g: 600, plates: 60 }],
          price_per_kg_tzs: marketSnapshot.pilau_masala!.price_per_kg_tzs,
          confidence: "high",
          is_estimate: false,
        },
        unitTable,
        ingredientMeta,
      ),
      shared_across_two_dishes: toMarketUnits(
        {
          ingredient_id: "pilau_masala",
          total_qty_g: 900,
          contributions: [
            { plan_index: 0, recipe_id: "pilau_ya_nyama", qty_g: 600, plates: 60 },
            { plan_index: 1, recipe_id: "other_dish", qty_g: 300, plates: 20 },
          ],
          price_per_kg_tzs: marketSnapshot.pilau_masala!.price_per_kg_tzs,
          confidence: "high",
          is_estimate: false,
        },
        unitTable,
        ingredientMeta,
      ),
    };
    expect(result).toEqual(golden("spice-allowance.json"));
  });

  it("a custom allowance override changes the line cost accordingly", () => {
    const line: PricedLine = {
      ingredient_id: "pilau_masala",
      total_qty_g: 100,
      contributions: [{ plan_index: 0, recipe_id: "r", qty_g: 100, plates: 5 }],
      price_per_kg_tzs: tzs(8000),
      confidence: "high",
      is_estimate: false,
    };
    const result = toMarketUnits(line, unitTable, ingredientMeta, 50);
    expect(result.line_cost_tzs).toBe(250); // 50 * 5 plates
  });
});

describe("toMarketUnits — error paths", () => {
  it("throws when ingredient metadata is missing", () => {
    const line = priced("rice", 1000);
    expect(() => toMarketUnits({ ...line, ingredient_id: "unknown" }, unitTable, ingredientMeta)).toThrow(
      /no ingredient metadata/,
    );
  });

  it("throws when a mboga/nyingine ingredient has no unit table entry", () => {
    const line: PricedLine = {
      ingredient_id: "onion",
      total_qty_g: 1000,
      contributions: [{ plan_index: 0, recipe_id: "r", qty_g: 1000, plates: 10 }],
      price_per_kg_tzs: tzs(1500),
      confidence: "high",
      is_estimate: false,
    };
    expect(() => toMarketUnits(line, {}, ingredientMeta)).toThrow(/no market units/);
  });

  it("falls back to buying by the kilo when an ingredient's unit table has no informal units at all", () => {
    const line: PricedLine = {
      ingredient_id: "onion",
      total_qty_g: 2500,
      contributions: [{ plan_index: 0, recipe_id: "r", qty_g: 2500, plates: 10 }],
      price_per_kg_tzs: tzs(1500),
      confidence: "high",
      is_estimate: false,
    };
    const kiloOnlyTable = { onion: [{ unit_name_sw: "kilo", grams_per_unit: 1000 }] };
    const result = toMarketUnits(line, kiloOnlyTable, ingredientMeta);
    expect(result.display_unit).toBe("kilo");
    expect(result.display_qty).toBe(3); // ceil(2500/1000)
  });
});

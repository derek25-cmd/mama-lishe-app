import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { priceIngredients } from "../priceIngredients.js";
import type { MergedLine } from "../types.js";
import { marketSnapshot, regionSnapshot, forecastSnapshot, emptySnapshot } from "./fixtures/data.js";

const dir = dirname(fileURLToPath(import.meta.url));
function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, "golden", name), "utf8"));
}

function line(id: string, qtyG = 1000): MergedLine {
  return { ingredient_id: id, total_qty_g: qtyG, contributions: [{ plan_index: 0, recipe_id: "r", qty_g: qtyG, plates: 10 }] };
}

describe("priceIngredients — fallback chain", () => {
  it("tier 1: resolves from the vendor's own market", () => {
    const result = priceIngredients([line("rice")], marketSnapshot, emptySnapshot, emptySnapshot);
    expect(result).toEqual(golden("price-fallback-market.json"));
    expect(result.lines[0]!.confidence).toBe("high");
    expect(result.lines[0]!.is_estimate).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("tier 2: falls back to the region average when the market snapshot misses", () => {
    const result = priceIngredients([line("cabbage")], emptySnapshot, regionSnapshot, emptySnapshot);
    expect(result).toEqual(golden("price-fallback-region.json"));
    expect(result.lines[0]!.confidence).toBe("low");
    expect(result.lines[0]!.is_estimate).toBe(true);
  });

  it("tier 3: falls back to the forecast when both market and region miss", () => {
    const result = priceIngredients([line("cabbage")], emptySnapshot, emptySnapshot, forecastSnapshot);
    expect(result).toEqual(golden("price-fallback-forecast.json"));
    expect(result.lines[0]!.confidence).toBe("forecast");
    expect(result.lines[0]!.is_estimate).toBe(true);
  });

  it("total miss: never drops the ingredient — price 0, confidence 'none', a MISSING_PRICE warning naming it", () => {
    const result = priceIngredients([line("cabbage")], emptySnapshot, emptySnapshot, emptySnapshot);
    expect(result).toEqual(golden("price-fallback-missing.json"));
    expect(result.lines).toHaveLength(1); // never dropped
    expect(result.lines[0]!.price_per_kg_tzs).toBe(0);
    expect(result.lines[0]!.confidence).toBe("none");
    expect(result.lines[0]!.is_estimate).toBe(true);
    expect(result.warnings).toEqual([
      { code: "MISSING_PRICE", ingredient_id: "cabbage", message: expect.stringContaining("cabbage") },
    ]);
  });

  it("prefers market over region over forecast when more than one tier has data", () => {
    const result = priceIngredients([line("rice")], marketSnapshot, regionSnapshot, forecastSnapshot);
    expect(result.lines[0]!.confidence).toBe("high"); // market tier wins, not region/forecast
  });
});

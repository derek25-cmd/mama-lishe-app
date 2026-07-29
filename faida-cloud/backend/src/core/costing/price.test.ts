import { describe, expect, it } from "vitest";
import { priceIngredients } from "./price.js";
import type { MarketPriceSnapshot } from "./types.js";

const snapshot: MarketPriceSnapshot = {
  market: { rice: { pricePerKgTzs: 2800, confidence: "high" } },
  regionAverage: { cabbage: 1200 },
  forecast: { cabbage: 1300, spice: 8000 },
};

describe("priceIngredients", () => {
  it("prices from the market tier when present", () => {
    const [result] = priceIngredients([{ ingredientId: "rice", qty: 12000 }], snapshot);
    expect(result).toEqual({
      ingredientId: "rice",
      qty: 12000,
      pricePerKgTzs: 2800,
      confidence: "high",
      source: "market",
      costTzs: 33600,
    });
  });

  it("falls back to region average, tagged confidence 'low', when market is missing", () => {
    const [result] = priceIngredients([{ ingredientId: "cabbage", qty: 1800 }], snapshot);
    expect(result).toEqual({
      ingredientId: "cabbage",
      qty: 1800,
      pricePerKgTzs: 1200,
      confidence: "low",
      source: "region_average",
      costTzs: 2160,
    });
  });

  it("falls back to forecast, tagged confidence 'forecast', when market and region average are missing", () => {
    const [result] = priceIngredients([{ ingredientId: "spice", qty: 600 }], snapshot);
    expect(result).toEqual({
      ingredientId: "spice",
      qty: 600,
      pricePerKgTzs: 8000,
      confidence: "forecast",
      source: "forecast",
      costTzs: 4800,
    });
  });

  it("throws when no tier has a price", () => {
    expect(() => priceIngredients([{ ingredientId: "unknown", qty: 100 }], snapshot)).toThrow(
      /no price available for ingredient unknown/,
    );
  });
});

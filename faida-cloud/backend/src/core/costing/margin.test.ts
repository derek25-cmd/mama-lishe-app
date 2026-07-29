import { describe, expect, it } from "vitest";
import { computeMargin } from "./margin.js";

describe("computeMargin", () => {
  it("rounds cost/plate up and snaps price to an exact 500 TZS multiple", () => {
    expect(computeMargin(30000, 10, 40)).toEqual({ costPerPlateTzs: 3000, recommendedPriceTzs: 5000 });
  });

  it("snaps a non-exact recommended price up to the next 500 TZS", () => {
    expect(computeMargin(280500, 60, 40)).toEqual({ costPerPlateTzs: 4675, recommendedPriceTzs: 8000 });
  });

  it("accepts a zero margin", () => {
    expect(computeMargin(12345, 3, 0)).toEqual({ costPerPlateTzs: 4115, recommendedPriceTzs: 4500 });
  });

  it("rejects plates below 1", () => {
    expect(() => computeMargin(1000, 0, 10)).toThrow(/plates must be >= 1/);
  });

  it("rejects a negative margin", () => {
    expect(() => computeMargin(1000, 10, -1)).toThrow(/targetMarginPct must be in \[0, 100\)/);
  });

  it("rejects a margin of 100 or more", () => {
    expect(() => computeMargin(1000, 10, 100)).toThrow(/targetMarginPct must be in \[0, 100\)/);
  });
});

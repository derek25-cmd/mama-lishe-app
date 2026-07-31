import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeMargins } from "../computeMargins.js";
import { tzs } from "../types.js";

const dir = dirname(fileURLToPath(import.meta.url));
function golden(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, "golden", name), "utf8"));
}

describe("computeMargins — snapping (hand-verified in hand-verification.md for the 40%/60-plate case)", () => {
  it("matches the golden margin-snapping cases byte for byte", () => {
    const result = {
      exact_multiple_of_500: computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(30000) }], 40),
      snap_pushes_margin_up: computeMargins([{ recipe_id: "d1", plates: 60, dish_cost_tzs: tzs(290100) }], 40),
      zero_margin: computeMargins([{ recipe_id: "d1", plates: 3, dish_cost_tzs: tzs(12345) }], 0),
      high_margin_near_100: computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(10000) }], 80),
    };
    expect(result).toEqual(golden("margin-snapping.json"));
  });

  it("when the raw price already lands exactly on a 500 boundary, snapping is a no-op and achieved == target", () => {
    const [dish] = computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(30000) }], 40);
    expect(dish!.recommended_price_tzs).toBe(5000);
    expect(dish!.achieved_margin_pct).toBe(40);
  });

  it("snapping pushes the achieved margin strictly above the target when the raw price isn't a clean multiple", () => {
    const [dish] = computeMargins([{ recipe_id: "d1", plates: 60, dish_cost_tzs: tzs(290100) }], 40);
    expect(dish!.achieved_margin_pct).toBeGreaterThan(40);
  });

  it("floating-point noise in (1 - marginFraction) never crosses a 500-TZS boundary it mathematically shouldn't", () => {
    // 1 - 0.8 is 0.19999999999999998 in IEEE-754, not exactly 0.2 — without
    // the cleanup in computeMargins.ts this would snap to 5500, not 5000.
    const [dish] = computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(10000) }], 80);
    expect(dish!.recommended_price_tzs).toBe(5000);
  });

  it("rejects a negative margin", () => {
    expect(() => computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(1000) }], -1)).toThrow(
      /targetMarginPct must be in \[0, 100\)/,
    );
  });

  it("rejects a margin of 100 or more", () => {
    expect(() => computeMargins([{ recipe_id: "d1", plates: 10, dish_cost_tzs: tzs(1000) }], 100)).toThrow(
      /targetMarginPct must be in \[0, 100\)/,
    );
  });
});

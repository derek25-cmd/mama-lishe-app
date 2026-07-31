import { z } from "zod";
import type { PoolClient } from "pg";
import type { VendorContext } from "@/lib/db";
import { withVendorContext } from "@/lib/db";
import {
  loadVendorRecipes,
  loadPriceSnapshot,
  loadRegionSnapshot,
  loadForecasts,
  loadUnitTable,
  loadIngredientMeta,
  type CacheStats,
} from "@/lib/costing/repository";
import { costPlan } from "@/core/costing/costPlan";
import type { CostingResult, PlanItem } from "@/core/costing/types";
import { costingDurationSeconds, costingMissingPriceTotal, costingStalePricesTotal } from "@/lib/costing/metrics";
import { logCostingRequest } from "@/lib/costing/log";

export const PlanItemBody = z.object({
  recipe: z.string().min(1),
  plates: z.number().int().min(1).max(2000),
});

export const PlanRequestBody = z.object({
  items: z.array(PlanItemBody).min(1),
  target_margin_pct: z.number().int().min(0).max(99).optional(),
});

export interface PriceFreshness {
  week_start: string;
  age_days: number;
  is_stale: boolean; // > 14 days old
}

const STALE_AFTER_DAYS = 14;

// Monday of the current ISO week, UTC — the same week identifier
// price.market_prices/forecasts key their rows on.
export function currentWeekStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

export function priceFreshness(priceWeek: string | null, now: Date = new Date()): PriceFreshness | null {
  if (!priceWeek) return null;
  const ageMs = now.getTime() - new Date(`${priceWeek}T00:00:00Z`).getTime();
  const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return { week_start: priceWeek, age_days: ageDays, is_stale: ageDays > STALE_AFTER_DAYS };
}

export class VendorMarketNotSetError extends Error {
  constructor() {
    super("vendor has no market_id assigned — cannot price a plan");
  }
}

interface VendorLocationRow {
  market_id: string | null;
  region_id: string | null;
  target_margin_pct: number;
}

// Shared by /plans/price (dry-run) and /plans (persist): resolves the
// vendor's recipes (cloning from ref.base_recipes on first reference),
// prices them through the market -> region -> forecast fallback, and runs
// the pure costPlan orchestrator. Never touches Postgres for persistence —
// callers that need to save the result do so themselves.
export async function computePlanCosting(
  ctx: VendorContext,
  items: { recipe: string; plates: number }[],
  targetMarginPct: number | undefined,
): Promise<{ result: CostingResult; vendor: VendorLocationRow }> {
  const startedAt = process.hrtime.bigint();

  const vendor = await withVendorContext(ctx, async (client: PoolClient) => {
    const row = await client.query<VendorLocationRow>(
      `select market_id, region_id, target_margin_pct from vendor.vendors where id = $1`,
      [ctx.vendorId],
    );
    return row.rows[0] ?? null;
  });
  if (!vendor) throw new Error(`vendor ${ctx.vendorId} not found`);
  if (!vendor.market_id) throw new VendorMarketNotSetError();

  const recipeNames = items.map((i) => i.recipe);
  const recipes = await loadVendorRecipes(ctx, recipeNames);
  const recipeByName = new Map(recipes.map((r) => [r.name_sw, r]));

  const weekStart = currentWeekStart();

  // Every cache-aside lookup on the request path reports into this shared
  // counter (repository.ts's loaders are given the same object) so the
  // duration metric below can be labelled cache_hit — "warm" means every
  // one of them hit, not just some.
  const cacheStats: CacheStats = { hits: 0, misses: 0 };

  const [priceSnapshot, regionSnapshot, forecastSnapshot, unitTable, ingredientMeta] = await Promise.all([
    loadPriceSnapshot(vendor.market_id, weekStart, cacheStats),
    vendor.region_id ? loadRegionSnapshot(vendor.region_id, weekStart) : Promise.resolve({}),
    loadForecasts(vendor.market_id, weekStart),
    loadUnitTable(vendor.market_id, cacheStats),
    loadIngredientMeta(cacheStats),
  ]);

  const planItems: PlanItem[] = items.map((item) => {
    const recipe = recipeByName.get(item.recipe);
    if (!recipe) throw new Error(`recipe "${item.recipe}" could not be resolved for this vendor`);
    return { recipe, plates: item.plates };
  });

  const result = costPlan(
    { items: planItems, target_margin_pct: targetMarginPct ?? vendor.target_margin_pct },
    { priceSnapshot, regionSnapshot, forecastSnapshot, unitTable, ingredientMeta },
  );

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const cacheHit = cacheStats.misses === 0;
  const freshness = priceFreshness(result.price_week);

  costingDurationSeconds.observe({ cache_hit: String(cacheHit) }, durationMs / 1000);
  for (const warning of result.warnings) {
    if (warning.code === "MISSING_PRICE" && warning.ingredient_id) {
      costingMissingPriceTotal.inc({ ingredient: warning.ingredient_id });
    }
  }
  if (freshness?.is_stale) costingStalePricesTotal.inc();

  logCostingRequest({
    vendorId: ctx.vendorId,
    marketId: vendor.market_id,
    dishCount: items.length,
    plates: items.reduce((sum, i) => sum + i.plates, 0),
    priceWeek: result.price_week,
    durationMs,
    cacheHit,
  });

  return { result, vendor };
}

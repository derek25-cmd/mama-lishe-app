import pino from "pino";
import type { PoolClient } from "pg";
import { query, withVendorContext, type VendorContext } from "@/lib/db";
import { redis } from "@/lib/redis";
import type {
  RecipeInput,
  RecipeIngredientInput,
  PriceSnapshot,
  PriceEntry,
  UnitTable,
  UnitOption,
  IngredientMeta,
  IngredientMetaEntry,
  Confidence,
  IngredientCategory,
} from "@/core/costing/types.js";
import { tzs } from "@/core/costing/types.js";

const logger = pino({ name: "faida-costing-repo" });

const PRICE_TTL_SECONDS = 8 * 24 * 60 * 60; // 8 days — a snapshot outlives its own week so the following week's fetch still has something to fall back on
const REFERENCE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — units/ingredient metadata change rarely, explicitly invalidated on the rare edit

function priceCacheKey(marketId: string, weekStart: string): string {
  return `prices:${marketId}:${weekStart}`;
}
function unitsCacheKey(marketId: string): string {
  return `units:${marketId}`;
}
const INGREDIENT_META_CACHE_KEY = "meta:ingredients";

// Cache is an optimization, never a dependency: any Redis error is logged
// and treated as a miss so a Redis outage degrades to "every request hits
// Postgres," not "costing breaks."
async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn({ err, key }, "cache read failed, falling through to postgres");
    return null;
  }
}

async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, "cache write failed, continuing without caching this value");
  }
}

// ---------- vendor recipes (clone-on-first-use) ----------

interface VendorRecipeRow {
  id: string;
  name_sw: string;
  base_plates: number;
}

interface VendorRecipeIngredientRow {
  ingredient_id: string;
  qty_per_base: string; // numeric comes back as string from pg
}

interface BaseRecipeRow {
  id: string;
  name_sw: string;
  base_plates: number;
}

interface BaseRecipeIngredientRow {
  ingredient_id: string;
  qty_per_base: string;
  is_optional: boolean;
}

// Loads each named recipe as that vendor's own costing.vendor_recipes row,
// cloning it from ref.base_recipes the first time it's referenced. After
// the clone, the vendor owns the row (DOC 05 intends vendor_recipes to be
// where vendor-specific ingredient substitutions eventually live); every
// later request for the same name reads the existing clone rather than
// the shared reference recipe.
//
// costing.vendor_recipe_ingredients has no is_optional column (unlike
// ref.base_recipe_ingredients) — a DOC 05 gap, flagged rather than silently
// worked around. Cloned ingredients default to is_optional: false, since a
// vendor's own recipe is a committed choice, not a menu of substitutions.
export async function loadVendorRecipes(ctx: VendorContext, recipeNames: string[]): Promise<RecipeInput[]> {
  return withVendorContext(ctx, async (client) => {
    const recipes: RecipeInput[] = [];

    for (const name of recipeNames) {
      const existing = await client.query<VendorRecipeRow>(
        `select id, name_sw, base_plates from costing.vendor_recipes
         where vendor_id = $1 and name_sw = $2 and is_active = true`,
        [ctx.vendorId, name],
      );

      let vendorRecipe = existing.rows[0];

      if (!vendorRecipe) {
        vendorRecipe = await cloneBaseRecipe(client, ctx.vendorId, name);
      }

      const ingredientRows = await client.query<VendorRecipeIngredientRow>(
        `select ingredient_id, qty_per_base from costing.vendor_recipe_ingredients where recipe_id = $1`,
        [vendorRecipe.id],
      );

      const ingredients: RecipeIngredientInput[] = ingredientRows.rows.map((row) => ({
        ingredient_id: row.ingredient_id,
        qty_per_base: Number(row.qty_per_base),
        is_optional: false,
      }));

      recipes.push({
        id: vendorRecipe.id,
        name_sw: vendorRecipe.name_sw,
        base_plates: vendorRecipe.base_plates,
        ingredients,
      });
    }

    return recipes;
  });
}

async function cloneBaseRecipe(client: PoolClient, vendorId: string, name: string): Promise<VendorRecipeRow> {
  const base = await client.query<BaseRecipeRow>(
    `select id, name_sw, base_plates from ref.base_recipes where name_sw = $1 and is_active = true`,
    [name],
  );
  const baseRecipe = base.rows[0];
  if (!baseRecipe) {
    throw new Error(`no base recipe named "${name}" found in ref.base_recipes`);
  }

  // Two concurrent first-references race here — the partial unique index on
  // (vendor_id, base_recipe_id) plus ON CONFLICT DO NOTHING means only one
  // insert wins; the loser falls through to the select below and reads the
  // winner's row instead of creating a duplicate clone.
  const inserted = await client.query<VendorRecipeRow>(
    `insert into costing.vendor_recipes (vendor_id, base_recipe_id, name_sw, base_plates)
     values ($1, $2, $3, $4)
     on conflict (vendor_id, base_recipe_id) where base_recipe_id is not null do nothing
     returning id, name_sw, base_plates`,
    [vendorId, baseRecipe.id, baseRecipe.name_sw, baseRecipe.base_plates],
  );

  let vendorRecipe = inserted.rows[0];

  if (!vendorRecipe) {
    const winner = await client.query<VendorRecipeRow>(
      `select id, name_sw, base_plates from costing.vendor_recipes where vendor_id = $1 and base_recipe_id = $2`,
      [vendorId, baseRecipe.id],
    );
    vendorRecipe = winner.rows[0];
    if (!vendorRecipe) {
      throw new Error(`clone-on-first-use race for vendor ${vendorId} / base recipe ${baseRecipe.id} left no row`);
    }
    return vendorRecipe;
  }

  const baseIngredients = await client.query<BaseRecipeIngredientRow>(
    `select ingredient_id, qty_per_base, is_optional from ref.base_recipe_ingredients where recipe_id = $1`,
    [baseRecipe.id],
  );

  for (const ing of baseIngredients.rows) {
    await client.query(
      `insert into costing.vendor_recipe_ingredients (recipe_id, ingredient_id, qty_per_base)
       values ($1, $2, $3)`,
      [vendorRecipe.id, ing.ingredient_id, ing.qty_per_base],
    );
  }

  return vendorRecipe;
}

// ---------- price snapshots ----------

interface MarketPriceRow {
  ingredient_id: string;
  price_per_kg_tzs: number;
  confidence: Confidence;
  week_start: string;
}

export async function loadPriceSnapshot(marketId: string, weekStart: string): Promise<PriceSnapshot> {
  const cacheKey = priceCacheKey(marketId, weekStart);
  const cached = await cacheGet<PriceSnapshot>(cacheKey);
  if (cached) return cached;

  const rows = await query<MarketPriceRow>(
    `select ingredient_id, price_per_kg_tzs, confidence, week_start::text
     from price.market_prices where market_id = $1 and week_start = $2`,
    [marketId, weekStart],
  );

  const snapshot = rowsToSnapshot(rows);
  await cacheSet(cacheKey, snapshot, PRICE_TTL_SECONDS);
  return snapshot;
}

// No region-level price table exists in DOC 05 — the "region" fallback tier
// is derived here by averaging that week's market prices across every
// market in the vendor's region. Flagged as a design choice, not a DOC 05
// literal: confidence is fixed at 'low' regardless of the underlying
// markets' own confidence, since a cross-market average is strictly less
// certain than any single observed market price.
export async function loadRegionSnapshot(regionId: string, weekStart: string): Promise<PriceSnapshot> {
  const rows = await query<{ ingredient_id: string; price_per_kg_tzs: string; week_start: string }>(
    `select mp.ingredient_id, round(avg(mp.price_per_kg_tzs))::text as price_per_kg_tzs, mp.week_start::text
     from price.market_prices mp
     join ref.markets m on m.id = mp.market_id
     where m.region_id = $1 and mp.week_start = $2
     group by mp.ingredient_id, mp.week_start`,
    [regionId, weekStart],
  );

  const snapshot: PriceSnapshot = {};
  for (const row of rows) {
    snapshot[row.ingredient_id] = {
      price_per_kg_tzs: tzs(Number(row.price_per_kg_tzs)),
      confidence: "low",
      week_start: row.week_start,
    };
  }
  return snapshot;
}

interface ForecastRow {
  ingredient_id: string;
  price_per_kg_tzs: number;
  week_start: string;
}

export async function loadForecasts(marketId: string, weekStart: string): Promise<PriceSnapshot> {
  const rows = await query<ForecastRow>(
    `select ingredient_id, price_per_kg_tzs, week_start::text
     from price.forecasts where market_id = $1 and week_start = $2`,
    [marketId, weekStart],
  );

  const snapshot: PriceSnapshot = {};
  for (const row of rows) {
    snapshot[row.ingredient_id] = {
      price_per_kg_tzs: tzs(row.price_per_kg_tzs),
      confidence: "forecast",
      week_start: row.week_start,
    };
  }
  return snapshot;
}

function rowsToSnapshot(rows: MarketPriceRow[]): PriceSnapshot {
  const snapshot: PriceSnapshot = {};
  for (const row of rows) {
    const entry: PriceEntry = {
      price_per_kg_tzs: tzs(row.price_per_kg_tzs),
      confidence: row.confidence,
      week_start: row.week_start,
    };
    snapshot[row.ingredient_id] = entry;
  }
  return snapshot;
}

// ---------- unit table & ingredient metadata ----------

interface UnitRow {
  ingredient_id: string;
  unit_name_sw: string;
  grams_per_unit: string;
}

// A market-specific unit (market_id = marketId) wins over the national
// default (market_id is null) for the same ingredient/unit name; DISTINCT
// ON picks the first row per (ingredient_id, unit_name_sw) once ordered so
// market-specific sorts first. Only currently-valid rows are considered.
export async function loadUnitTable(marketId: string): Promise<UnitTable> {
  const cacheKey = unitsCacheKey(marketId);
  const cached = await cacheGet<UnitTable>(cacheKey);
  if (cached) return cached;

  const rows = await query<UnitRow>(
    `select distinct on (ingredient_id, unit_name_sw)
       ingredient_id, unit_name_sw, grams_per_unit::text
     from ref.ingredient_units
     where (market_id = $1 or market_id is null)
       and valid_from <= current_date
       and (valid_to is null or valid_to >= current_date)
     order by ingredient_id, unit_name_sw, market_id nulls last`,
    [marketId],
  );

  const table: UnitTable = {};
  for (const row of rows) {
    const option: UnitOption = { unit_name_sw: row.unit_name_sw, grams_per_unit: Number(row.grams_per_unit) };
    (table[row.ingredient_id] ??= []).push(option);
  }

  await cacheSet(cacheKey, table, REFERENCE_TTL_SECONDS);
  return table;
}

interface IngredientMetaRow {
  id: string;
  name_sw: string;
  category: string;
  canonical_unit: "g" | "ml";
}

export async function loadIngredientMeta(): Promise<IngredientMeta> {
  const cached = await cacheGet<IngredientMeta>(INGREDIENT_META_CACHE_KEY);
  if (cached) return cached;

  const rows = await query<IngredientMetaRow>(
    `select id, name_sw, category, canonical_unit from ref.ingredients where is_active = true`,
  );

  const meta: IngredientMeta = {};
  for (const row of rows) {
    const entry: IngredientMetaEntry = {
      name_sw: row.name_sw,
      category: toIngredientCategory(row.category),
      canonical_unit: row.canonical_unit,
    };
    meta[row.id] = entry;
  }

  await cacheSet(INGREDIENT_META_CACHE_KEY, meta, REFERENCE_TTL_SECONDS);
  return meta;
}

const KNOWN_CATEGORIES: readonly IngredientCategory[] = ["nafaka", "mboga", "nyama", "viungo", "mafuta", "nyingine"];

// ref.ingredients.category is free text (DOC 05 §2), seeded and curated by
// ops — trusted at this boundary rather than defended against, same as the
// rest of this codebase's convention for internally-governed data. An
// unrecognized category is an ops seed-data bug, not a request the vendor
// can trigger, so it fails loudly here instead of silently defaulting.
function toIngredientCategory(category: string): IngredientCategory {
  if ((KNOWN_CATEGORIES as readonly string[]).includes(category)) return category as IngredientCategory;
  throw new Error(`ref.ingredients has an unrecognized category "${category}" — ops seed-data bug`);
}

// ---------- invalidation ----------

// Explicit invalidation for when ops publishes a new weekly price snapshot
// or edits a market's unit table out of band — call after either write so
// the next costing request doesn't serve a stale cache entry for the
// remainder of its TTL.
export async function invalidateMarket(marketId: string): Promise<void> {
  try {
    const priceKeys = await redis.keys(priceCacheKey(marketId, "*"));
    const keysToDelete = [...priceKeys, unitsCacheKey(marketId)];
    if (keysToDelete.length > 0) await redis.del(...keysToDelete);
  } catch (err) {
    logger.warn({ err, marketId }, "cache invalidation failed — stale entries may serve until TTL expiry");
  }
}

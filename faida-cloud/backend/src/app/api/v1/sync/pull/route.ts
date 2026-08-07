import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuth, requireRole } from "@/lib/auth/middleware";
import { withVendorContext } from "@/lib/db";

// Row caps per stream, sized to keep a typical page well under the 50KB
// target (these are small platform-wide reference tables at pilot scale —
// tens to low hundreds of rows, not thousands) while still bounding worst
// case. If the serialized body would exceed the 200KB hard cap anyway, the
// dynamically-changing streams (market_prices, vendor_recipes) truncate
// and report hasMore so the next pull picks up where this one left off.
const INGREDIENT_LIMIT = 500;
const RECIPE_LIMIT = 200;
const UNIT_LIMIT = 1000;
const MARKET_PRICE_PAGE = 500;
const VENDOR_RECIPE_PAGE = 200;
const HARD_CAP_BYTES = 200 * 1024;

interface PullCursor {
  marketPricesSince: string | null; // price.market_prices.published_at
  vendorRecipesSince: string | null; // costing.vendor_recipes.updated_at
}

function decodeCursor(raw: string | null): PullCursor {
  if (!raw) return { marketPricesSince: null, vendorRecipesSince: null };
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed && typeof parsed === "object") {
      const p = parsed as Partial<PullCursor>;
      return {
        marketPricesSince: typeof p.marketPricesSince === "string" ? p.marketPricesSince : null,
        vendorRecipesSince: typeof p.vendorRecipesSince === "string" ? p.vendorRecipesSince : null,
      };
    }
  } catch {
    // fall through to the default below
  }
  return { marketPricesSince: null, vendorRecipesSince: null };
}

function encodeCursor(cursor: PullCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export const GET = requireAuth(
  requireRole(
    "vendor",
    "vendor_owner",
  )(async (req, ctx) => {
    const url = new URL(req.url);
    const marketId = url.searchParams.get("marketId");
    if (!marketId) {
      return NextResponse.json({ error: "invalid_request", message: "marketId is required" }, { status: 400 });
    }
    const cursor = decodeCursor(url.searchParams.get("since"));

    const data = await withVendorContext({ vendorId: ctx.vendorId, role: ctx.role }, async (client) => {
      // ---------- static reference streams: no change-tracking column
      // exists on ref.ingredients or ref.base_recipes in the current
      // schema (DOC 05 has no updated_at on either), and ref.ingredient_
      // units only has valid_from (when a rate becomes effective, not a
      // true last-modified stamp — an edited row without a fresh
      // valid_from would not be caught). Flagged rather than faking a
      // delta these tables can't actually support: all three are returned
      // as full snapshots every pull, bounded by the limits above. This is
      // safe at current data volumes (a market's full reference set is
      // small) but would need real change-tracking columns added to scale
      // further — a schema gap, not a decision made lightly.
      const ingredients = await client.query(
        `select id, name_sw, name_en, category, canonical_unit, is_active
         from ref.ingredients where is_active = true order by id limit $1`,
        [INGREDIENT_LIMIT],
      );

      const ingredientUnits = await client.query(
        `select id, ingredient_id, market_id, unit_name_sw, grams_per_unit, valid_from, valid_to, source
         from ref.ingredient_units
         where (market_id = $1 or market_id is null)
           and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
         order by id limit $2`,
        [marketId, UNIT_LIMIT],
      );

      const baseRecipes = await client.query(
        `select id, name_sw, name_en, category, base_plates, version, is_active
         from ref.base_recipes where is_active = true order by id limit $1`,
        [RECIPE_LIMIT],
      );
      const baseRecipeIds = baseRecipes.rows.map((r) => (r as { id: string }).id);
      const baseRecipeIngredients = await client.query(
        `select recipe_id, ingredient_id, qty_per_base, is_optional
         from ref.base_recipe_ingredients where recipe_id = any($1::uuid[])`,
        [baseRecipeIds],
      );

      // ---------- true-delta streams ----------
      const marketPrices = await client.query(
        `select id, market_id, ingredient_id, week_start, price_per_kg_tzs, sample_size, confidence, pct_change_wow, published_at
         from price.market_prices
         where market_id = $1 and ($2::timestamptz is null or published_at > $2::timestamptz)
         order by published_at nulls first, id
         limit $3`,
        [marketId, cursor.marketPricesSince, MARKET_PRICE_PAGE + 1],
      );
      const marketPricesHasMore = marketPrices.rows.length > MARKET_PRICE_PAGE;
      const marketPriceRows = marketPricesHasMore ? marketPrices.rows.slice(0, MARKET_PRICE_PAGE) : marketPrices.rows;
      const newMarketPricesSince =
        marketPriceRows.length > 0
          ? ((marketPriceRows[marketPriceRows.length - 1] as { published_at: Date | null }).published_at?.toISOString() ??
            cursor.marketPricesSince)
          : cursor.marketPricesSince;

      const vendorRecipes = await client.query(
        `select id, vendor_id, base_recipe_id, name_sw, base_plates, sell_price_tzs, is_active, updated_at
         from costing.vendor_recipes
         where vendor_id = $1 and ($2::timestamptz is null or updated_at > $2::timestamptz)
         order by updated_at nulls first, id
         limit $3`,
        [ctx.vendorId, cursor.vendorRecipesSince, VENDOR_RECIPE_PAGE + 1],
      );
      const vendorRecipesHasMore = vendorRecipes.rows.length > VENDOR_RECIPE_PAGE;
      const vendorRecipeRows = vendorRecipesHasMore ? vendorRecipes.rows.slice(0, VENDOR_RECIPE_PAGE) : vendorRecipes.rows;
      const newVendorRecipesSince =
        vendorRecipeRows.length > 0
          ? ((vendorRecipeRows[vendorRecipeRows.length - 1] as { updated_at: Date | null }).updated_at?.toISOString() ??
            cursor.vendorRecipesSince)
          : cursor.vendorRecipesSince;

      return {
        ingredients: ingredients.rows,
        ingredientUnits: ingredientUnits.rows,
        baseRecipes: baseRecipes.rows.map((r) => ({
          ...(r as object),
          ingredients: baseRecipeIngredients.rows.filter(
            (i) => (i as { recipe_id: string }).recipe_id === (r as { id: string }).id,
          ),
        })),
        marketPrices: marketPriceRows,
        vendorRecipes: vendorRecipeRows,
        hasMore: marketPricesHasMore || vendorRecipesHasMore,
        nextCursor: encodeCursor({ marketPricesSince: newMarketPricesSince, vendorRecipesSince: newVendorRecipesSince }),
      };
    });

    // The ETag must be computed from content that's identical across two
    // otherwise-unchanged pulls. syncedAt (current server time) changes on
    // every single request by definition — hashing it in would mean the
    // ETag never matches twice and 304 could never fire, defeating the
    // entire point. It's added to the body only after the hash is taken.
    const stableContent = {
      cursor: data.nextCursor,
      hasMore: data.hasMore,
      ingredients: data.ingredients,
      ingredientUnits: data.ingredientUnits,
      baseRecipes: data.baseRecipes,
      marketPrices: data.marketPrices,
      vendorRecipes: data.vendorRecipes,
    };
    const stableSerialized = JSON.stringify(stableContent);
    const etag = `"${createHash("sha256").update(stableSerialized).digest("hex")}"`;

    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: { ETag: etag } });
    }

    const body = { syncedAt: new Date().toISOString(), ...stableContent };
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > HARD_CAP_BYTES) {
      // Should not happen at pilot data volumes given the caps above —
      // logged loudly rather than silently shipping an oversized payload
      // to a vendor on a metered data bundle.
      console.error(`sync/pull payload exceeded the 200KB hard cap for market ${marketId}`);
    }

    return new NextResponse(serialized, {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: etag },
    });
  }),
);

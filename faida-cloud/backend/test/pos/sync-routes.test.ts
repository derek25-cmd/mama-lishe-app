import { describe, it, expect } from "vitest";
import { ulid } from "ulid";
import { NextRequest } from "next/server";
import { getPool } from "@/lib/db";
import { createTestVendor, authedJsonRequest, authedGet } from "./helpers";
import { POST as syncPush } from "@/app/api/v1/sync/push/route";
import { GET as syncPull } from "@/app/api/v1/sync/pull/route";

interface PushResult {
  clientId: string;
  status: string;
  serverId?: string;
  reason?: string;
}
interface PushResponse {
  results: PushResult[];
}

describe("POST /api/v1/sync/push (route layer)", () => {
  it("applies a mixed batch and returns per-record results", async () => {
    const { accessToken } = await createTestVendor();
    const body = {
      deviceId: "route-test-device",
      records: [
        {
          type: "sale",
          clientId: ulid(),
          clientCreatedAt: "2026-10-01T10:00:00Z",
          payload: { soldAt: "2026-10-01T10:00:00Z", quantity: 1, unitPriceTzs: 2000, totalTzs: 2000, paymentMethod: "cash" },
        },
        {
          type: "expense",
          clientId: ulid(),
          clientCreatedAt: "2026-10-01T09:00:00Z",
          payload: { spentAt: "2026-10-01T09:00:00Z", category: "kodi", amountTzs: 5000 },
        },
      ],
    };

    const res = await syncPush(authedJsonRequest("http://test/api/v1/sync/push", accessToken, "POST", body));
    expect(res.status).toBe(200);
    const json = (await res.json()) as PushResponse;
    expect(json.results).toHaveLength(2);
    expect(json.results.every((r) => r.status === "applied")).toBe(true);
  });

  it("rejects a batch over 500 records with 400", async () => {
    const { accessToken } = await createTestVendor();
    const records = Array.from({ length: 501 }, () => ({
      type: "expense" as const,
      clientId: ulid(),
      clientCreatedAt: "2026-10-01T09:00:00Z",
      payload: { spentAt: "2026-10-01T09:00:00Z", category: "kodi" as const, amountTzs: 1000 },
    }));
    const res = await syncPush(
      authedJsonRequest("http://test/api/v1/sync/push", accessToken, "POST", { deviceId: "d", records }),
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_body");
  });

  it("rejects a malformed body with 400 invalid_body", async () => {
    const { accessToken } = await createTestVendor();
    const res = await syncPush(
      authedJsonRequest("http://test/api/v1/sync/push", accessToken, "POST", { deviceId: "d", records: "not-an-array" }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a deni sale record with no deniCustomerName at the validation layer", async () => {
    const { accessToken } = await createTestVendor();
    const res = await syncPush(
      authedJsonRequest("http://test/api/v1/sync/push", accessToken, "POST", {
        deviceId: "d",
        records: [
          {
            type: "sale",
            clientId: ulid(),
            clientCreatedAt: "2026-10-01T10:00:00Z",
            payload: { soldAt: "2026-10-01T10:00:00Z", quantity: 1, unitPriceTzs: 1000, totalTzs: 1000, paymentMethod: "deni" },
          },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("401s without an Authorization header", async () => {
    const res = await syncPush(new NextRequest("http://test/api/v1/sync/push", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });
});

interface PullResponse {
  syncedAt: string;
  cursor: string;
  hasMore: boolean;
  ingredients: unknown[];
  ingredientUnits: unknown[];
  baseRecipes: unknown[];
  marketPrices: unknown[];
  vendorRecipes: unknown[];
}

describe("GET /api/v1/sync/pull (route layer)", () => {
  it("returns reference-data streams and a working ETag/304", async () => {
    const { vendorId, accessToken } = await createTestVendor();
    const pool = getPool();

    // Testcontainers runs migrations only, no seed data — this route's
    // real behavior (non-empty streams, not just the empty-array shape)
    // needs at least one row in each table it reads, created directly here.
    const region = await pool.query<{ id: string }>(
      `insert into ref.regions (name, code) values ('Test Region', 'TR-${ulid().slice(-6)}') returning id`,
    );
    const market = await pool.query<{ id: string }>(
      `insert into ref.markets (region_id, name) values ($1, 'Test Market') returning id`,
      [region.rows[0]!.id],
    );
    const marketId = market.rows[0]!.id;
    const ingredient = await pool.query<{ id: string }>(
      `insert into ref.ingredients (name_sw, name_en, category, canonical_unit) values ('Mchele', 'Rice', 'nafaka', 'g') returning id`,
    );
    await pool.query(`insert into ref.ingredient_units (ingredient_id, unit_name_sw, grams_per_unit) values ($1, 'kilo', 1000)`, [
      ingredient.rows[0]!.id,
    ]);
    const baseRecipe = await pool.query<{ id: string }>(
      `insert into ref.base_recipes (name_sw, name_en) values ('Wali', 'Rice') returning id`,
    );
    await pool.query(
      `insert into ref.base_recipe_ingredients (recipe_id, ingredient_id, qty_per_base) values ($1, $2, 500)`,
      [baseRecipe.rows[0]!.id, ingredient.rows[0]!.id],
    );
    await pool.query(
      `insert into price.market_prices (market_id, ingredient_id, week_start, price_per_kg_tzs, sample_size, confidence, published_at)
       values ($1, $2, current_date, 2500, 5, 'high', now())`,
      [marketId, ingredient.rows[0]!.id],
    );
    await pool.query(
      `insert into costing.vendor_recipes (vendor_id, base_recipe_id, name_sw) values ($1, $2, 'Wali')`,
      [vendorId, baseRecipe.rows[0]!.id],
    );

    const res1 = await syncPull(authedGet(`http://test/api/v1/sync/pull?marketId=${marketId}`, accessToken));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as PullResponse;
    expect(body1.ingredients.length).toBeGreaterThan(0);
    expect(body1.ingredientUnits.length).toBeGreaterThan(0);
    expect(body1.baseRecipes.length).toBeGreaterThan(0);
    expect(body1.marketPrices.length).toBeGreaterThan(0);
    expect(body1.vendorRecipes.length).toBeGreaterThan(0);
    expect(typeof body1.syncedAt).toBe("string");
    const etag = res1.headers.get("etag");
    expect(etag).toBeTruthy();

    const res2 = await syncPull(
      new NextRequest(`http://test/api/v1/sync/pull?marketId=${marketId}`, {
        headers: { authorization: `Bearer ${accessToken}`, "if-none-match": etag! },
      }),
    );
    expect(res2.status).toBe(304);

    // A pull using the cursor this first pull returned exercises the
    // since-cursor decode/delta path. No new market_prices/vendor_recipes
    // rows exist after body1.cursor's watermark, so the delta streams
    // should come back empty (or, at most, re-include the same boundary
    // row — Postgres timestamptz has microsecond precision but the
    // cursor's ISO string round-trips through JS Date at millisecond
    // precision, so a row published in the same millisecond as the cursor
    // can occasionally reappear; that's the safe direction to err in for
    // a sync feed — a harmless duplicate, never a lost row). The real
    // assertion here is that the since-cursor code path runs cleanly, not
    // the exact boundary count.
    const res3 = await syncPull(
      authedGet(`http://test/api/v1/sync/pull?marketId=${marketId}&since=${encodeURIComponent(body1.cursor)}`, accessToken),
    );
    expect(res3.status).toBe(200);
    const body3 = (await res3.json()) as PullResponse;
    expect(body3.marketPrices.length).toBeLessThanOrEqual(1);
    expect(body3.vendorRecipes.length).toBeLessThanOrEqual(1);
  });

  it("400s when marketId is missing", async () => {
    const { accessToken } = await createTestVendor();
    const res = await syncPull(authedGet("http://test/api/v1/sync/pull", accessToken));
    expect(res.status).toBe(400);
  });

  it("sets hasMore when a vendor has more vendor_recipes than one page", async () => {
    const { vendorId, accessToken } = await createTestVendor();
    const pool = getPool();
    const region = await pool.query<{ id: string }>(
      `insert into ref.regions (name, code) values ('Test Region 2', 'TR2-${ulid().slice(-6)}') returning id`,
    );
    const market = await pool.query<{ id: string }>(
      `insert into ref.markets (region_id, name) values ($1, 'Test Market 2') returning id`,
      [region.rows[0]!.id],
    );
    const marketId = market.rows[0]!.id;

    // VENDOR_RECIPE_PAGE is 200 in the route — 201 rows forces hasMore.
    await pool.query(
      `insert into costing.vendor_recipes (vendor_id, name_sw)
       select $1, 'Recipe ' || g from generate_series(1, 201) as g`,
      [vendorId],
    );

    const res = await syncPull(authedGet(`http://test/api/v1/sync/pull?marketId=${marketId}`, accessToken));
    expect(res.status).toBe(200);
    const body = (await res.json()) as PullResponse;
    expect(body.vendorRecipes).toHaveLength(200);
    expect(body.hasMore).toBe(true);
  });
});

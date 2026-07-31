// Task 7 end-to-end verification: authenticates as a real test vendor
// through the actual OTP login flow (not a minted token — this exercises
// the deployed auth stack too), ensures that vendor + a minimal price
// snapshot exist so the request isn't degenerate, then calls the live
// POST /plans/price and prints a human-readable shopping list, per-dish
// costing, and total.
//
// This is a one-off manual verification script (like scripts/seed.ts), not
// part of the automated test suite. Run with:
//   DATABASE_URL=... npx tsx scripts/verify-costing.ts
//
// Requires `docker compose logs` to be runnable from the current directory
// (or VERIFY_COMPOSE_DIR pointed at the faida-cloud/ directory) — the OTP
// code is only ever printed to the api service's logs by design
// (src/lib/notifications/sms.ts's ConsoleSmsSender), never returned over
// HTTP or written anywhere else, so reading it back is how a script proves
// login actually works end to end rather than bypassing it.
import { execSync } from "node:child_process";
import pg from "pg";
import Redis from "ioredis";
import { normalizePhone, maskPhone } from "../src/lib/auth/phone.js";

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost";
const COMPOSE_DIR = process.env.VERIFY_COMPOSE_DIR ?? "..";
const TEST_PHONE = normalizePhone(process.env.VERIFY_TEST_PHONE ?? "+255799000001");
if (!TEST_PHONE) throw new Error("VERIFY_TEST_PHONE did not normalize to a valid Tanzanian phone number");

const REQUEST: { items: { recipe: string; plates: number }[]; target_margin_pct: number } = {
  items: [
    { recipe: "Pilau ya nyama", plates: 60 },
    { recipe: "Wali maharage", plates: 30 },
  ],
  target_margin_pct: 40,
};

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureTestVendorHasMarketAndPrices(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL must be set (ops-level setup step, bypasses RLS deliberately)");

  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    // findOrCreateVendorByPhone (triggered by the OTP verify call below)
    // only creates the vendor.vendors row — a brand-new vendor has no
    // market_id/region_id yet (that's real onboarding, out of scope here).
    // This script's own responsibility is making the row it will use
    // costable, same as an ops admin would during onboarding.
    const vendor = await pool.query<{ id: string }>(`select id from vendor.vendors where phone = $1`, [TEST_PHONE]);
    if (!vendor.rows[0]) return; // vendor doesn't exist yet — created on first OTP verify, re-run after that

    const market = await pool.query<{ id: string; region_id: string }>(
      `select id, region_id from ref.markets where is_active = true limit 1`,
    );
    const chosenMarket = market.rows[0];
    if (!chosenMarket) throw new Error("no active market in ref.markets to assign the test vendor to");

    await pool.query(`update vendor.vendors set market_id = $1, region_id = $2 where id = $3`, [
      chosenMarket.id,
      chosenMarket.region_id,
      vendor.rows[0].id,
    ]);

    const weekStart = currentWeekStart();
    const ingredients = await pool.query<{ ingredient_id: string }>(
      `select distinct ri.ingredient_id
       from ref.base_recipe_ingredients ri
       join ref.base_recipes r on r.id = ri.recipe_id
       where r.name_sw = any($1)`,
      [REQUEST.items.map((i) => i.recipe)],
    );

    for (const row of ingredients.rows) {
      // A deliberately plausible placeholder price (2500 TZS/kg) — this is
      // verification data, not real market intelligence; Phase 6's
      // crowdsourcing pipeline is what populates this table for real.
      await pool.query(
        `insert into price.market_prices (market_id, ingredient_id, week_start, price_per_kg_tzs, sample_size, confidence)
         values ($1, $2, $3, 2500, 5, 'high')
         on conflict (market_id, ingredient_id, week_start) do nothing`,
        [chosenMarket.id, row.ingredient_id, weekStart],
      );
    }

    // repository.ts's loadPriceSnapshot caches its result for 8 days. This
    // script writes straight to Postgres, bypassing that cache entirely —
    // without busting it, a snapshot cached before this run (e.g. from an
    // earlier manual test against the same market/week) would still be
    // served, silently missing whatever this run just inserted and falling
    // through to the region-average tier for exactly those ingredients.
    // Same key format as repository.ts's priceCacheKey/unitsCacheKey.
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      const redis = new Redis(redisUrl);
      try {
        await redis.del(`prices:${chosenMarket.id}:${weekStart}`, `units:${chosenMarket.id}`);
      } finally {
        redis.disconnect();
      }
    }
  } finally {
    await pool.end();
  }
}

// Mirrors plan.ts's currentWeekStart exactly — duplicated rather than
// imported because this script deliberately stays outside src/ (it's an
// ops tool, not application code) and the duplication is 6 lines.
function currentWeekStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d.toISOString().slice(0, 10);
}

async function requestOtp(phone: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) throw new Error(`otp/request failed: ${res.status} ${await res.text()}`);
}

// Reads the code straight out of the api container's own logs — the
// ConsoleSmsSender's one and only output. Retries briefly since `docker
// compose logs` can lag a moment behind the container's stdout.
async function readOtpFromLogs(phone: string): Promise<string> {
  const masked = maskPhone(phone);
  for (let attempt = 0; attempt < 10; attempt++) {
    const logs = execSync(`docker compose logs api --no-color --since 2m`, {
      cwd: COMPOSE_DIR,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = logs.split("\n").filter((l) => l.includes(`to=${masked}`));
    const lastLine = lines[lines.length - 1];
    const match = lastLine?.match(/verification code is (\d{6})/);
    if (match) return match[1]!;
    await sleep(1000);
  }
  throw new Error(`could not find an OTP code for ${masked} in \`docker compose logs api\``);
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function verifyOtp(phone: string, code: string): Promise<TokenPair> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) throw new Error(`otp/verify failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenPair;
}

interface ShoppingLine {
  ingredient_id: string;
  name_sw: string;
  display_qty: number;
  display_unit: string;
  unit_price_tzs: number;
  line_cost_tzs: number;
  price_confidence: string;
  is_estimate: boolean;
}

interface DishCosting {
  recipe_id: string;
  plates: number;
  dish_cost_tzs: number;
  cost_per_plate_tzs: number;
  recommended_price_tzs: number;
  achieved_margin_pct: number;
}

interface CostingWarning {
  code: string;
  ingredient_id?: string;
  message: string;
}

interface PriceResponse {
  lines: ShoppingLine[];
  dishes: DishCosting[];
  total_cost_tzs: number;
  price_week: string | null;
  warnings: CostingWarning[];
  price_freshness: { week_start: string; age_days: number; is_stale: boolean } | null;
}

async function priceThePlan(accessToken: string): Promise<PriceResponse> {
  const res = await fetch(`${BASE_URL}/api/v1/plans/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(REQUEST),
  });
  if (!res.ok) throw new Error(`POST /plans/price failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PriceResponse;
}

function padRight(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + " ".repeat(width - value.length);
}
function padLeft(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : " ".repeat(width - value.length) + value;
}

function printShoppingList(result: PriceResponse): void {
  const columns = [
    { header: "Ingredient", width: 24 },
    { header: "Qty", width: 8 },
    { header: "Unit", width: 8 },
    { header: "Unit Price", width: 12 },
    { header: "Line Cost", width: 12 },
    { header: "Confidence", width: 11 },
  ];
  const rule = "-".repeat(columns.reduce((sum, c) => sum + c.width + 1, 0));

  console.log("\nSHOPPING LIST");
  console.log(rule);
  console.log(columns.map((c) => padRight(c.header, c.width)).join(" "));
  console.log(rule);
  for (const line of result.lines) {
    console.log(
      [
        padRight(line.name_sw, columns[0]!.width),
        padLeft(String(line.display_qty), columns[1]!.width),
        padRight(line.display_unit, columns[2]!.width),
        padLeft(line.unit_price_tzs.toLocaleString(), columns[3]!.width),
        padLeft(line.line_cost_tzs.toLocaleString(), columns[4]!.width),
        padRight(line.price_confidence + (line.is_estimate ? "*" : ""), columns[5]!.width),
      ].join(" "),
    );
  }
  console.log(rule);

  console.log("\nPER-DISH COSTING");
  for (const dish of result.dishes) {
    console.log(
      `  ${dish.recipe_id}  plates=${dish.plates}  cost=${dish.dish_cost_tzs.toLocaleString()} TZS  ` +
        `cost/plate=${dish.cost_per_plate_tzs.toLocaleString()} TZS  ` +
        `price=${dish.recommended_price_tzs.toLocaleString()} TZS  ` +
        `margin=${dish.achieved_margin_pct.toFixed(1)}%`,
    );
  }

  console.log(`\nTOTAL: ${result.total_cost_tzs.toLocaleString()} TZS`);
  console.log(
    `PRICE WEEK: ${result.price_week ?? "none"}` +
      (result.price_freshness
        ? `  (${result.price_freshness.age_days}d old${result.price_freshness.is_stale ? ", STALE" : ""})`
        : ""),
  );
  if (result.warnings.length > 0) {
    console.log(`WARNINGS: ${result.warnings.length}`);
    for (const w of result.warnings) console.log(`  - [${w.code}] ${w.message}`);
  }
}

async function main() {
  console.log(`verify-costing: authenticating as ${maskPhone(TEST_PHONE!)} against ${BASE_URL}`);

  await requestOtp(TEST_PHONE!);
  const code = await readOtpFromLogs(TEST_PHONE!);
  const tokens = await verifyOtp(TEST_PHONE!, code);
  console.log("login ok");

  await ensureTestVendorHasMarketAndPrices();

  const result = await priceThePlan(tokens.accessToken);
  printShoppingList(result);
}

main().catch((err: unknown) => {
  console.error("verify-costing FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
